import { querySessionEntityList, querySessionEditorDraftResources } from '@/services/entity-query.service';
import { queryWeaponSpecData, queryWeaponSprites } from '@/services/weapon-data.service';
import type { RowData, WeaponEditorData } from '@/shared/types';

export async function queryWeaponEditorData(sessionId: string, id: string, signal?: AbortSignal): Promise<WeaponEditorData> {
  const data = await queryWeaponSpecData(sessionId, id, undefined, signal);
  return { kind: 'weapon', spec: data.weapon, target: data.target, baseVersions: data.baseVersions, isNew: data.isNew };
}
export async function queryWeaponProjectileOptions(sessionId: string, signal?: AbortSignal) {
  const data = await querySessionEntityList(sessionId, 'projectile', signal);
  return data.map((entry) => ({ label: entry.id, value: entry.id }));
}
export async function queryWeaponEditorImages(sessionId: string, id: string, draft: RowData, signal?: AbortSignal) {
  const refs = await querySessionEditorDraftResources(sessionId, 'weapon', id, draft, signal);
  return { resourceRefs: Object.values(refs), spriteData: await queryWeaponSprites(sessionId, refs, signal) };
}
