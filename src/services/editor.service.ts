import {
  querySessionEntity,
  querySessionEditorDraftResources,
  querySessionEntityEditTarget,
  querySessionEntityIdentityIntent,
} from '@/services/entity-query.service';
import { AppError, withCause } from '@/shared/lib/errors';
import { queryResourceDataUrls } from '@/services/resource-cache.service';
import { invokeCommand } from '@/shared/runtime/command.runtime';
import { createShipSpec, createSystemSpec } from '@/domain/editors/spec-construction';
import { entityContentId } from '@/domain/editors/entity-identity';
import { requireRowData } from '@/shared/lib/row-data';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { queryJointCandidate } from '@/services/joint-edit.service';
import { jointObject } from '@/domain/joint-edit';
import { shipBuiltInWeaponIds, type ShipWeaponSources, type ShipWeaponSource } from '@/domain/editors/ship-weapons';
import { formatError } from '@/shared/lib/errors';
import type { JointEditRoot } from '@/shared/types';
import type { EntityEditTarget, EditorSpecKind, EntityData, ProjectSessionId, ResourceRef, RowData, WriteResult } from '@/shared/types';

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

export async function queryShipEditorData(
  sessionId: ProjectSessionId,
  id: string,
  signal?: AbortSignal,
): Promise<import('@/shared/types').SpecEditorData<'ship'>> {
  const record = await querySessionEntity(sessionId, 'ship', id, signal);
  const data = record ? cloneQuerySnapshot<EntityData>(record) : null;
  const info = data ?? (await querySessionEntityEditTarget(sessionId, 'ship', id, signal));
  return {
    kind: 'ship',
    spec: data ? requireRowData(data.data, '舰船 ' + id + ' 数据无效') : createShipSpec(id),
    target: info.target,
    baseVersions: cloneQuerySnapshot<import('@/shared/types').FileVersion[]>(info.baseVersions),
    isNew: info.target.state === 'create',
  };
}
export async function querySystemEditorData(
  sessionId: ProjectSessionId,
  id: string,
  signal?: AbortSignal,
): Promise<import('@/shared/types').SpecEditorData<'system'>> {
  const record = await querySessionEntity(sessionId, 'system', id, signal);
  const data = record ? cloneQuerySnapshot<EntityData>(record) : null;
  const info = data ?? (await querySessionEntityEditTarget(sessionId, 'system', id, signal));
  return {
    kind: 'system',
    spec: data ? requireRowData(data.data, '战术系统 ' + id + ' 数据无效') : createSystemSpec(id),
    target: info.target,
    baseVersions: cloneQuerySnapshot<import('@/shared/types').FileVersion[]>(info.baseVersions),
    isNew: info.target.state === 'create',
  };
}
export async function queryShipEditorImages(sessionId: string, id: string, draft: RowData, signal?: AbortSignal) {
  const refs = await querySessionEditorDraftResources(sessionId, 'ship', id, draft, signal);
  const spriteData = await querySpriteData(sessionId, refs.sprite ?? null, signal);
  return {
    resourceRefs: Object.values(refs),
    spriteData,
    diagnostic: draft.spriteName && !spriteData ? '找不到贴图：' + draft.spriteName : '',
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

function ensureSpecContext(modRoot: string, id: string) {
  if (!modRoot) {
    throw new AppError('缺少 spec 保存的 mod 根目录', { action: 'save-spec' });
  }
  if (!id) {
    throw new AppError('缺少 spec 保存 id', { action: 'save-spec' });
  }
}
