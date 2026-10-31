import { querySessionEntity, querySessionEntityEditTarget } from '@/services/entity-query.service';
import { createSystemSpec } from '@/domain/entity-write/spec-construction';
import { requireRowData } from '@/shared/lib/row-data';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import type { EntityData, ProjectSessionId } from '@/shared/types';

export async function querySpecSystemEditorData(
  sessionId: ProjectSessionId,
  id: string,
  signal?: AbortSignal,
): Promise<import('@/shared/types/index').SpecEditorData<'system'>> {
  const record = await querySessionEntity(sessionId, 'system', id, signal);
  const data = record ? cloneQuerySnapshot<EntityData>(record) : null;
  const info = data ?? (await querySessionEntityEditTarget(sessionId, 'system', id, signal));
  return {
    kind: 'system',
    composition: data?.composition,
    spec: data ? requireRowData(data.data, '战术系统 ' + id + ' 数据无效') : createSystemSpec(id),
    target: info.target,
    baseVersions: cloneQuerySnapshot<import('@/shared/types/index').FileVersion[]>(info.baseVersions),
    isNew: info.target.state === 'create',
  };
}
