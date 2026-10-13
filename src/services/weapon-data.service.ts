import { querySessionEntity, querySessionEditorDraftResources } from '@/services/entity-query.service';
import { queryResourceDataUrls } from '@/services/resource-cache.service';
import { AppError } from '@/shared/lib/errors';
import { requireRowData } from '@/shared/lib/row-data';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { createWeaponSpec } from '@/domain/editors/spec-construction';
import { inferWeaponSpecClass } from '@/domain/tables/associated-spec-creation';
import { WEAPON_SPRITE_FIELDS } from '@/domain/editors/lib/weapon-sprite-fields';
import type { DeepReadonly, EntityData, EntityEditInfo, EditorSpecKind, ProjectSessionId, ResourceRef, RowData } from '@/shared/types';
export interface WeaponData extends EntityEditInfo {
  weapon: RowData;
  weaponCsvRow: RowData;
  projectileSpecs: Record<string, RowData>;
  resourceRefs: ResourceRef[];
  weaponSpriteData: Record<string, string>;
  isNew: boolean;
}
export async function queryWeaponData(
  sessionId: ProjectSessionId,
  id: string,
  weaponOverride?: RowData,
  signal?: AbortSignal,
): Promise<WeaponData> {
  const weapon = requireEditorEntity(await querySessionEntity(sessionId, 'weapon', id, signal), 'weapon', id);
  const weaponEntity = requireRowData(weapon.data, `武器 ${id} 数据无效`);
  const savedWeaponSpec = requireRowData(weaponEntity.spec, `武器 ${id} spec 数据无效`);
  const weaponCsvRow = requireRowData(weaponEntity.csvRow, `武器 ${id} CSV 数据无效`);
  const isNew = Object.keys(savedWeaponSpec).length === 0;
  const weaponSpec = weaponOverride ?? (isNew ? createWeaponSpec(id, inferWeaponSpecClass(weaponCsvRow)) : savedWeaponSpec);
  const resourceRefs = weaponOverride
    ? await querySessionEditorDraftResources(sessionId, 'weapon', id, weaponOverride, signal)
    : weapon.resourceRefs;
  const projectileSpecs = await queryWeaponProjectiles(sessionId, weaponSpec, signal);
  return {
    weapon: weaponSpec,
    target: weapon.target,
    baseVersions: weapon.baseVersions,
    weaponCsvRow,
    isNew,
    projectileSpecs,
    resourceRefs: Object.values(resourceRefs),
    weaponSpriteData: await queryWeaponSprites(sessionId, resourceRefs, signal),
  };
}
export async function queryWeaponSprites(
  sessionId: ProjectSessionId,
  refs: Record<string, ResourceRef>,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  const resources: { field: string; resource: ResourceRef }[] = [];
  for (const field of WEAPON_SPRITE_FIELDS) {
    const resource = refs[field];
    if (resource) resources.push({ field, resource });
  }
  if (resources.length === 0) return {};
  const dataUrls = await queryResourceDataUrls(
    sessionId,
    resources.map((entry) => entry.resource),
    signal,
  );
  return Object.fromEntries(
    dataUrls.flatMap((dataUrl, index) => {
      const entry = resources[index];
      return dataUrl && entry ? [[entry.field, dataUrl] as const] : [];
    }),
  );
}
export async function queryWeaponProjectiles(
  sessionId: ProjectSessionId,
  weapon: RowData,
  signal?: AbortSignal,
): Promise<Record<string, RowData>> {
  const id = typeof weapon.projectileSpecId === 'string' ? weapon.projectileSpecId : '';
  if (!id) return {};
  const record = await querySessionEntity(sessionId, 'projectile', id, signal);
  if (!record) return {};
  const projectile = cloneQuerySnapshot<EntityData>(record);
  return { [id]: requireRowData(projectile.data, `弹体 ${id} 数据无效`) };
}
function requireEditorEntity(entity: DeepReadonly<EntityData> | null, kind: EditorSpecKind, id: string): EntityData {
  if (entity) return cloneQuerySnapshot<EntityData>(entity);
  throw new AppError(`找不到 ${id} 的 ${kind} 数据。`, { action: 'query-editor-entity' });
}
