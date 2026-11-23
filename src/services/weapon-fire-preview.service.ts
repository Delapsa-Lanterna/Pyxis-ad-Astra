import { querySessionEntity } from '@/services/entity-query.service';
import { requireRowData } from '@/shared/lib/row-data';
import { shallowReadonly } from 'vue';
import { queryWeaponSpecData } from '@/services/weapon-data.service';
import { querySessionDraftResources } from '@/services/resource-reference.service';
import { weaponAnimationFrameCount } from '@/domain/weapon-fire-preview/preview-definition';
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
  let projectileSpec: RowData | null = null;
  const baseVersions = [...data.baseVersions],
    resources: WeaponFirePreviewData['resources'] = {
      weapon: Object.fromEntries(data.resourceRefs.map((resource) => [resource.key, resource])),
      projectile: {},
    };
  if (weaponAnimationFrameCount(data.weapon) > 1) {
    const weapon = { ...data.weapon };
    for (const field of ['turretSprite', 'hardpointSprite']) {
      if (weapon[field] === undefined && resources.weapon[field]) weapon[field] = resources.weapon[field].relPath;
    }
    const frames = await querySessionDraftResources(sessionId, 'weapon', id, weapon, signal, { weaponAnimationFrames: true });
    resources.weapon = { ...resources.weapon, ...frames };
  }
  if (data.weapon.specClass !== 'beam') {
    const id = typeof data.weapon.projectileSpecId === 'string' ? data.weapon.projectileSpecId : '';
    const projectile = id ? await querySessionEntity(sessionId, 'projectile', id, signal) : null;
    if (!projectile) throw new AppError('找不到预览弹体 ' + id + '。', { action: 'query-weapon-fire-preview' });
    for (const version of projectile.baseVersions) baseVersions.push(version);
    resources.projectile = projectile.resourceRefs;
    projectileSpec = cloneQuerySnapshot(requireRowData(projectile.data, '弹体 ' + id + ' 数据无效'));
  }
  return shallowReadonly({
    sessionId,
    baseVersions,
    weapon: data.weapon,
    weaponCsvRow: data.weaponCsvRow,
    projectile: projectileSpec,
    resources,
  });
}
