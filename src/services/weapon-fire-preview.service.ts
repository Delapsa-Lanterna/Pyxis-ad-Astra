import { querySessionEntity } from '@/services/entity-query.service';
import { requireRowData } from '@/shared/lib/row-data';
import { shallowReadonly } from 'vue';
import { queryWeaponSpecData, queryWeaponSprites } from '@/services/weapon-data.service';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { AppError } from '@/shared/lib/errors';
import type { DeepReadonly, RowData, WeaponFirePreviewSource, WeaponFirePreviewData } from '@/shared/types';
export async function queryWeaponFirePreviewData(
  sessionId: string,
  id: string,
  source: DeepReadonly<WeaponFirePreviewSource>,
  signal?: AbortSignal,
): Promise<WeaponFirePreviewData> {
  const data = await queryWeaponSpecData(
    sessionId,
    id,
    source.kind === 'draft' ? cloneQuerySnapshot<RowData>(source.weapon) : undefined,
    signal,
  );
  const projectileSpecs: Record<string, RowData> = {};
  const baseVersions = [...data.baseVersions],
    resourceRefs = [...data.resourceRefs];
  if (data.weapon.specClass !== 'beam') {
    const id = typeof data.weapon.projectileSpecId === 'string' ? data.weapon.projectileSpecId : '';
    const projectile = id ? await querySessionEntity(sessionId, 'projectile', id, signal) : null;
    if (!projectile) throw new AppError('找不到预览弹体 ' + id + '。', { action: 'query-weapon-fire-preview' });
    baseVersions.push(...projectile.baseVersions);
    resourceRefs.push(...Object.values(projectile.resourceRefs));
    projectileSpecs[id] = cloneQuerySnapshot(requireRowData(projectile.data, '弹体 ' + id + ' 数据无效'));
  }
  return shallowReadonly({
    baseVersions,
    weapon: data.weapon,
    weaponCsvRow: data.weaponCsvRow,
    projectileSpecs,
    resourceRefs,
    weaponSpriteData: {},
  });
}

export function queryWeaponFirePreviewImages(sessionId: string, refs: WeaponFirePreviewData['resourceRefs'], signal?: AbortSignal) {
  return queryWeaponSprites(
    sessionId,
    Object.fromEntries(refs.filter((ref) => ref.ownerKind === 'weapon').map((ref) => [ref.key, ref])),
    signal,
  );
}
