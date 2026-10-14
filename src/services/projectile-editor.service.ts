import { querySessionEntity, querySessionEntityEditTarget, querySessionEditorDraftResources } from '@/services/entity-query.service';
import { queryResourceDataUrls } from '@/services/resource-cache.service';
import { str } from '@/shared/lib/starsector';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { requireRowData } from '@/shared/lib/row-data';
import { createProjectileSpec } from '@/domain/editors/lib/projectile-fields';
import type { EntityData, ProjectileEditorData } from '@/shared/types';

export async function queryProjectileEditorData(sessionId: string, id: string, signal?: AbortSignal): Promise<ProjectileEditorData> {
  const record = await querySessionEntity(sessionId, 'projectile', id, signal);
  const data = record ? cloneQuerySnapshot<EntityData>(record) : null;
  const info = data ?? (await querySessionEntityEditTarget(sessionId, 'projectile', id, signal));
  return {
    kind: 'projectile',
    spec: data ? requireRowData(data.data, '弹体 ' + id + ' 数据无效') : createProjectileSpec(id),
    target: info.target,
    baseVersions: cloneQuerySnapshot<import('@/shared/types').FileVersion[]>(info.baseVersions),
    isNew: info.target.state === 'create',
  };
}

export async function queryProjectileEditorImages(
  sessionId: string,
  id: string,
  draft: import('@/shared/types').RowData,
  signal?: AbortSignal,
) {
  const refs = await querySessionEditorDraftResources(sessionId, 'projectile', id, draft, signal);
  const field = draft.specClass === 'missile' ? 'sprite' : 'bulletSprite';
  const resource = refs[field];
  if (!resource) return { resourceRefs: [], spriteData: {} as Record<string, string> };
  const [data] = await queryResourceDataUrls(sessionId, [resource], signal);
  return { resourceRefs: [resource], spriteData: { [field]: data ?? '' }, diagnostic: data ? '' : '找不到贴图：' + str(draft[field]) };
}
