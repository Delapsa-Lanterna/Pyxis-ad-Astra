import type {
  SaveModInfoPayload,
  ProjectSessionId,
  RowData,
  DeleteIndexedConfigEntityPayload,
  IndexedConfigEntityPayload,
  JsonWriteOptions,
  WriteResult,
} from '@/shared/types';
import { querySessionEntityEditTarget, querySessionEntityIdentityIntent } from '@/services/entity-query.service';
import { querySessionDraftResources } from '@/services/resource-reference.service';
import { hydrateFactionPreviewImages, hydrateMissionIcon } from '@/services/json-resource.service';
import type { ConfigFactionPreviewImages } from '@/domain/json-editor/json-config-records';

import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { invokeCommand } from '@/shared/runtime/command.runtime';

export function saveModInfo(
  sessionId: string,
  modRoot: string,
  data: RowData,
  jsonWrite: JsonWriteOptions,
  baseVersions: import('@/shared/types').FileVersion[] = [],
): Promise<WriteResult> {
  return invokeCommand('save_mod_info', {
    payload: { baseVersions, sessionId, modRoot, data, jsonWrite, orderedJson: JSON.stringify(data) } satisfies SaveModInfoPayload,
  });
}

export function saveIndexedConfigEntity(
  write: Omit<IndexedConfigEntityPayload, 'jsonWrite' | 'orderedJson'>,
  jsonWrite?: JsonWriteOptions,
): Promise<WriteResult> {
  return invokeCommand('save_indexed_config_entity', {
    payload: {
      modRoot: write.modRoot,
      baseVersions: write.baseVersions,
      sessionId: write.sessionId,
      kind: write.kind,
      previousId: write.previousId,
      nextId: write.nextId,
      indexRow: write.indexRow,
      entityData: write.entityData,
      ...(jsonWrite
        ? { jsonWrite, orderedJson: JSON.stringify(write.kind === 'faction' ? write.entityData.file : write.entityData.descriptor) }
        : {}),
    } satisfies IndexedConfigEntityPayload,
  });
}

export function createIndexedConfigEntity(write: Omit<IndexedConfigEntityPayload, 'jsonWrite' | 'orderedJson'>): Promise<WriteResult> {
  return invokeCommand('create_indexed_config_entity', { payload: { ...write } satisfies IndexedConfigEntityPayload });
}

export function deleteIndexedConfigEntity(write: DeleteIndexedConfigEntityPayload): Promise<WriteResult> {
  return invokeCommand('delete_indexed_config_entity', { payload: write satisfies DeleteIndexedConfigEntityPayload });
}

export async function captureConfigIdentityIntent(
  sessionId: string,
  kind: import('@/shared/types').EntityKind,
  sourceId: string,
  nextId: string,
) {
  const info = cloneQuerySnapshot<import('@/shared/types').EntityEditInfo>(await querySessionEntityEditTarget(sessionId, kind, sourceId));
  const intent = await querySessionEntityIdentityIntent(sessionId, info.target, nextId);
  return { info, intent: cloneQuerySnapshot<import('@/shared/types').EntityIdentityIntent>(intent) };
}

export async function queryFactionPreviewImages(
  sessionId: ProjectSessionId,
  id: string,
  draft: RowData,
  signal?: AbortSignal,
): Promise<ConfigFactionPreviewImages> {
  const resources = await querySessionDraftResources(sessionId, 'faction', id, draft, signal);
  return hydrateFactionPreviewImages(sessionId, resources, signal);
}

export async function queryMissionDraftIcon(
  sessionId: ProjectSessionId,
  id: string,
  draft: RowData,
  signal?: AbortSignal,
): Promise<string> {
  const resources = await querySessionDraftResources(sessionId, 'mission', id, draft, signal);
  return hydrateMissionIcon(sessionId, resources.icon ?? null, signal);
}
