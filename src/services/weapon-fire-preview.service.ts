import { shallowReadonly } from 'vue';
import { queryWeaponData } from '@/services/weapon-data.service';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { AppError } from '@/shared/lib/errors';
import type { DeepReadonly, RowData, WeaponFirePreviewSource, WeaponFirePreviewData } from '@/shared/types';
export async function queryWeaponFirePreviewData(
  sessionId: string,
  id: string,
  source: DeepReadonly<WeaponFirePreviewSource>,
  signal?: AbortSignal,
): Promise<WeaponFirePreviewData> {
  const data = await queryWeaponData(
    sessionId,
    id,
    source.kind === 'draft' ? cloneQuerySnapshot<RowData>(source.weapon) : undefined,
    signal,
  );
  if (data.weapon.specClass !== 'beam') {
    const id = typeof data.weapon.projectileSpecId === 'string' ? data.weapon.projectileSpecId : '';
    if (!id || !data.projectileSpecs[id]) throw new AppError('找不到预览弹体 ' + id + '。', { action: 'query-weapon-fire-preview' });
  }
  return shallowReadonly({
    weapon: data.weapon,
    weaponCsvRow: data.weaponCsvRow,
    projectileSpecs: data.projectileSpecs,
    resourceRefs: data.resourceRefs,
    weaponSpriteData: data.weaponSpriteData,
  });
}
