import {
  querySessionEntity,
  querySessionEntityList,
  querySessionEditorDraftResources,
  querySessionEntityEditTarget,
  querySessionEntityIdentityIntent,
} from '@/services/entity-query.service';
import { AppError, withCause } from '@/shared/lib/errors';
import { queryResourceDataUrls } from '@/services/resource-cache.service';
import { invokeCommand } from '@/shared/runtime/command.runtime';
import { createShipSpec, createProjectileSpec, createSystemSpec } from '@/domain/editors/spec-construction';
import { queryWeaponData, queryWeaponSprites, queryWeaponProjectiles } from '@/services/weapon-data.service';
import { entityContentId } from '@/domain/editors/entity-identity';
import { requireRowData } from '@/shared/lib/row-data';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { queryJointCandidate } from '@/services/joint-edit.service';
import { jointObject } from '@/domain/joint-edit';
import { shipBuiltInWeaponIds, type ShipWeaponSources, type ShipWeaponSource } from '@/domain/editors/ship-weapons';
import { formatError } from '@/shared/lib/errors';
import type { JointEditRoot } from '@/shared/types';
import type {
  EntityEditInfo,
  EntityEditTarget,
  EditorSpecKind,
  EditorWindowKind,
  EntityData,
  ProjectSessionId,
  ResourceRef,
  RowData,
  WriteResult,
} from '@/shared/types';

type EditorSelectOption = { label: string; value: string };

export async function queryShipWeaponSources(root: JointEditRoot, ship: RowData, signal?: AbortSignal): Promise<ShipWeaponSources> {
  const ids = shipBuiltInWeaponIds(ship);
  const [hull, ...results] = await Promise.allSettled([
    queryJointCandidate({ ...root, kind: 'ship' }, signal),
    ...ids.map((id) => queryJointCandidate({ ...root, kind: 'weapon', id }, signal)),
  ]);
  const hullSnapshot = hull!.status === 'fulfilled' ? hull!.value : null;
  const csv = hullSnapshot?.records.find((record) => record.key === hullSnapshot.bindings.csv);
  const hints = jointObject(csv?.value).hints;
  const weapons = Object.fromEntries(
    ids.map((id, index): [string, ShipWeaponSource] => {
      const result = results[index]!;
      if (result.status === 'rejected')
        return [id, { spec: null, resources: {}, projectile: {}, projectileResources: {}, diagnostic: formatError(result.reason) }];
      const snapshot = result.value;
      const spec = snapshot.records.find((record) => record.key === snapshot.bindings.spec);
      const projectile = snapshot.records.find((record) => record.key === snapshot.bindings.projectile);
      return [
        id,
        {
          spec: spec?.value.state === 'present' ? jointObject(spec.value) : null,
          resources: cloneQuerySnapshot<Record<string, ResourceRef>>(spec?.resourceRefs ?? {}),
          projectile: jointObject(projectile?.value),
          projectileResources: cloneQuerySnapshot<Record<string, ResourceRef>>(projectile?.resourceRefs ?? {}),
          diagnostic: '',
        },
      ];
    }),
  );
  return {
    hints:
      typeof hints === 'string'
        ? hints
            .split(',')
            .map((hint) => hint.trim())
            .filter(Boolean)
        : [],
    weapons,
    diagnostic: hull!.status === 'rejected' ? '舰体渲染提示读取失败：' + formatError(hull!.reason) : '',
  };
}

export type EditorEntityBundle =
  ShipEditorEntityBundle | WeaponEditorEntityBundle | ProjectileEditorEntityBundle | SystemEditorEntityBundle;

export interface ShipEditorEntityBundle extends EntityEditInfo {
  kind: 'ship';
  ship: RowData;
  resourceRefs: ResourceRef[];
  shipSpriteData: string;
  isNew: boolean;
}

export interface WeaponEditorEntityBundle extends EntityEditInfo {
  kind: 'weapon';
  weapon: RowData;
  weaponCsvRow: RowData;
  projectileSpecs: Record<string, RowData>;
  projectileOptions: EditorSelectOption[];
  resourceRefs: ResourceRef[];
  weaponSpriteData: Record<string, string>;
  isNew: boolean;
}

export interface ProjectileEditorEntityBundle extends EntityEditInfo {
  kind: 'projectile';
  projectile: RowData;
  projectileSpecs: Record<string, RowData>;
  isNew: boolean;
}

export interface SystemEditorEntityBundle extends EntityEditInfo {
  kind: 'system';
  system: RowData;
  isNew: boolean;
}

export async function queryEditorEntityBundle(
  sessionId: ProjectSessionId,
  kind: EditorWindowKind,
  id: string,
  signal?: AbortSignal,
): Promise<EditorEntityBundle> {
  return BUNDLE_LOADERS[kind](sessionId, id, { signal });
}

export async function refreshBundleResources(
  sessionId: ProjectSessionId,
  bundle: EditorEntityBundle,
  signal?: AbortSignal,
): Promise<EditorEntityBundle> {
  if (bundle.kind === 'ship') {
    return {
      ...bundle,
      shipSpriteData: await querySpriteData(sessionId, bundle.resourceRefs.find((resource) => resource.key === 'sprite') ?? null, signal),
    };
  }
  if (bundle.kind === 'weapon') {
    return { ...bundle, weaponSpriteData: await queryWeaponSprites(sessionId, resourceRefsByKey(bundle.resourceRefs), signal) };
  }
  return bundle;
}

export async function queryDraftEditorImages(
  sessionId: ProjectSessionId,
  kind: 'ship' | 'weapon',
  id: string,
  draft: RowData,
  signal?: AbortSignal,
) {
  const refs = await querySessionEditorDraftResources(sessionId, kind, id, draft, signal);
  return {
    resourceRefs: Object.values(refs),
    shipSpriteData: kind === 'ship' ? await querySpriteData(sessionId, refs.sprite ?? null, signal) : '',
    weaponSpriteData: kind === 'weapon' ? await queryWeaponSprites(sessionId, refs, signal) : {},
  };
}

export async function refreshBundleProjectiles(
  sessionId: ProjectSessionId,
  bundle: EditorEntityBundle,
  options: { projectileSpecs: boolean; projectileOptions: boolean },
  signal?: AbortSignal,
): Promise<EditorEntityBundle> {
  if (bundle.kind !== 'weapon') return bundle;
  return {
    ...bundle,
    projectileSpecs: options.projectileSpecs ? await queryWeaponProjectiles(sessionId, bundle.weapon, signal) : bundle.projectileSpecs,
    projectileOptions: options.projectileOptions ? await queryProjectileOptions(sessionId, signal) : bundle.projectileOptions,
  };
}

const BUNDLE_LOADERS: Record<
  EditorWindowKind,
  (sessionId: ProjectSessionId, id: string, options: { signal?: AbortSignal }) => Promise<EditorEntityBundle>
> = {
  ship: (sessionId, id, { signal }) => queryShipEditorBundle(sessionId, id, signal),
  weapon: (sessionId, id, { signal }) => queryWeaponEditorBundle(sessionId, id, signal),
  projectile: (sessionId, id, { signal }) => queryProjectileEditorBundle(sessionId, id, signal),
  system: (sessionId, id, { signal }) => querySystemEditorBundle(sessionId, id, signal),
};

async function queryShipEditorBundle(sessionId: ProjectSessionId, id: string, signal?: AbortSignal): Promise<ShipEditorEntityBundle> {
  const record = await querySessionEntity(sessionId, 'ship', id, signal);
  const ship = record ? cloneQuerySnapshot<EntityData>(record) : null;
  const info = ship ?? (await querySessionEntityEditTarget(sessionId, 'ship', id, signal));
  const shipSpec = ship ? requireRowData(ship.data, `舰船 ${id} 数据无效`) : createShipSpec(id);
  return {
    kind: 'ship',
    target: info.target,
    baseVersions: cloneQuerySnapshot<import('@/shared/types').FileVersion[]>(info.baseVersions),
    ship: shipSpec,
    resourceRefs: ship ? Object.values(ship.resourceRefs) : [],
    shipSpriteData: ship ? await querySpriteData(sessionId, ship.resourceRefs.sprite ?? null, signal) : '',
    isNew: info.target.state === 'create',
  };
}

async function queryWeaponEditorBundle(sessionId: ProjectSessionId, id: string, signal?: AbortSignal): Promise<WeaponEditorEntityBundle> {
  const bundle = await queryWeaponData(sessionId, id, undefined, signal);
  return {
    kind: 'weapon',
    ...bundle,
    projectileOptions: await queryProjectileOptions(sessionId, signal),
  };
}

async function queryProjectileEditorBundle(
  sessionId: ProjectSessionId,
  id: string,
  signal?: AbortSignal,
): Promise<ProjectileEditorEntityBundle> {
  const record = await querySessionEntity(sessionId, 'projectile', id, signal);
  const projectile = record ? cloneQuerySnapshot<EntityData>(record) : null;
  const info = projectile ?? (await querySessionEntityEditTarget(sessionId, 'projectile', id, signal));
  const spec = projectile ? requireRowData(projectile.data, `弹体 ${id} 数据无效`) : createProjectileSpec(id);
  return {
    kind: 'projectile',
    target: info.target,
    baseVersions: cloneQuerySnapshot<import('@/shared/types').FileVersion[]>(info.baseVersions),
    projectile: spec,
    projectileSpecs: { [id]: spec },
    isNew: info.target.state === 'create',
  };
}

async function querySystemEditorBundle(sessionId: ProjectSessionId, id: string, signal?: AbortSignal): Promise<SystemEditorEntityBundle> {
  const record = await querySessionEntity(sessionId, 'system', id, signal);
  const system = record ? cloneQuerySnapshot<EntityData>(record) : null;
  const info = system ?? (await querySessionEntityEditTarget(sessionId, 'system', id, signal));
  return {
    kind: 'system',
    target: info.target,
    baseVersions: cloneQuerySnapshot<import('@/shared/types').FileVersion[]>(info.baseVersions),
    system: system ? requireRowData(system.data, `战术系统 ${id} 数据无效`) : createSystemSpec(id),
    isNew: info.target.state === 'create',
  };
}

export async function saveEditorSpecByKind(
  sessionId: string,
  modRoot: string,
  target: EntityEditTarget,
  data: RowData,
  jsonWrite?: import('@/shared/types').JsonWriteOptions,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  ensureSpecContext(modRoot, target.id);
  try {
    const result = await saveEditorSpec(sessionId, modRoot, target, data, jsonWrite, baseVersions);
    return { ...result, refreshedEntity: requireRowData(result.refreshedEntity, '规格保存返回内容无效') };
  } catch (error) {
    throw withCause(`保存 ${target.id} spec 失败`, error, `save-${target.kind}-spec`);
  }
}

export function saveEditorSpec(
  sessionId: string,
  modRoot: string,
  target: EntityEditTarget,
  data: RowData,
  jsonWrite?: import('@/shared/types').JsonWriteOptions,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return invokeCommand('save_editor_spec', {
    payload: {
      baseVersions,
      sessionId,
      modRoot,
      target,
      data,
      ...(jsonWrite ? { jsonWrite, orderedJson: JSON.stringify(data) } : {}),
    },
  });
}

export function queryEditorIdentityIntent(sessionId: string, source: EntityEditTarget, content: RowData, signal?: AbortSignal) {
  return querySessionEntityIdentityIntent(sessionId, source, entityContentId(source.kind, content), signal).then((intent) =>
    cloneQuerySnapshot<import('@/shared/types').EntityIdentityIntent>(intent),
  );
}
export async function loadImportedSpecFile(kind: EditorSpecKind, path: string): Promise<RowData> {
  return invokeCommand('load_imported_editor_spec_file', { payload: { kind, path } });
}

async function querySpriteData(sessionId: ProjectSessionId, resource: ResourceRef | null, signal?: AbortSignal): Promise<string> {
  if (!resource) return '';
  return (await queryResourceDataUrls(sessionId, [resource], signal))[0] ?? '';
}

function resourceRefsByKey(resources: ResourceRef[]): Record<string, ResourceRef> {
  return Object.fromEntries(resources.map((resource) => [resource.key, resource]));
}

async function queryProjectileOptions(sessionId: ProjectSessionId, signal?: AbortSignal): Promise<EditorSelectOption[]> {
  const projectiles = await querySessionEntityList(sessionId, 'projectile', signal);
  return projectiles.map((projectile) => ({ label: projectile.id, value: projectile.id }));
}

function ensureSpecContext(modRoot: string, id: string) {
  if (!modRoot) {
    throw new AppError('缺少 spec 保存的 mod 根目录', { action: 'save-spec' });
  }
  if (!id) {
    throw new AppError('缺少 spec 保存 id', { action: 'save-spec' });
  }
}
