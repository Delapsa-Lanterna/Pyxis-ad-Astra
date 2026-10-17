import { querySessionEntity, querySessionEntityEditTarget } from '@/services/entity-query.service';
import { querySessionDraftResources } from '@/services/resource-reference.service';
import { queryResourceDataUrls } from '@/services/resource-cache.service';
import { str } from '@/shared/lib/starsector/index';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { requireRowData } from '@/shared/lib/row-data';
import { createProjectileSpec } from '@/domain/spec-editor/projectile/spec-projectile-model';
import type { EntityData, SpecProjectileEditorData } from '@/shared/types/index';

export async function querySpecProjectileEditorData(
  sessionId: string,
  id: string,
  signal?: AbortSignal,
): Promise<SpecProjectileEditorData> {
  const record = await querySessionEntity(sessionId, 'projectile', id, signal);
  const data = record ? cloneQuerySnapshot<EntityData>(record) : null;
  const info = data ?? (await querySessionEntityEditTarget(sessionId, 'projectile', id, signal));
  return {
    kind: 'projectile',
    spec: data ? requireRowData(data.data, '弹体 ' + id + ' 数据无效') : createProjectileSpec(id),
    target: info.target,
    baseVersions: cloneQuerySnapshot<import('@/shared/types/index').FileVersion[]>(info.baseVersions),
    isNew: info.target.state === 'create',
  };
}

export async function querySpecProjectileEditorImages(
  sessionId: string,
  id: string,
  draft: import('@/shared/types/index').RowData,
  signal?: AbortSignal,
) {
  const refs = await querySessionDraftResources(sessionId, 'projectile', id, draft, signal);
  const field = draft.specClass === 'missile' ? 'sprite' : 'bulletSprite';
  const resource = refs[field];
  if (!resource) return { resourceRefs: [], spriteData: {} as Record<string, string> };
  const [data] = await queryResourceDataUrls(sessionId, [resource], signal);
  return { resourceRefs: [resource], spriteData: { [field]: data ?? '' }, diagnostic: data ? '' : '找不到贴图：' + str(draft[field]) };
}
