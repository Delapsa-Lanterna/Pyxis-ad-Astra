import { querySessionEntityList } from '@/services/entity-query.service';
import { querySessionDraftResources } from '@/services/resource-reference.service';
import { queryWeaponSpecData, queryWeaponSprites } from '@/services/weapon-data.service';
import type { RowData, SpecWeaponEditorData } from '@/shared/types/index';

export async function querySpecWeaponEditorData(sessionId: string, id: string, signal?: AbortSignal): Promise<SpecWeaponEditorData> {
  const data = await queryWeaponSpecData(sessionId, id, undefined, signal);
  return { kind: 'weapon', spec: data.weapon, target: data.target, baseVersions: data.baseVersions, isNew: data.isNew };
}
export async function querySpecWeaponProjectileOptions(sessionId: string, signal?: AbortSignal) {
  const data = await querySessionEntityList(sessionId, 'projectile', signal);
  return data.map((entry) => ({ label: entry.id, value: entry.id }));
}
export async function querySpecWeaponEditorImages(sessionId: string, id: string, draft: RowData, signal?: AbortSignal) {
  const refs = await querySessionDraftResources(sessionId, 'weapon', id, draft, signal);
  return { resourceRefs: Object.values(refs), spriteData: await queryWeaponSprites(sessionId, refs, signal) };
}
