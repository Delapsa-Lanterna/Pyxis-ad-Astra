import type { SaveCommandRequest } from '@/shared/runtime/command.runtime';
import { captureSaveEdits } from '@/domain/project/save-edits';
import type {
  ModInfoSave,
  ProjectSessionId,
  RowData,
  IndexedConfigDelete,
  IndexedConfigSave,
  JsonWriteOptions,
  WriteResult,
} from '@/shared/types';
import { querySessionEntityEditTarget, querySessionEntityIdentityIntent } from '@/services/entity-query.service';
import { querySessionDraftResources } from '@/services/resource-reference.service';
import { hydrateFactionPreviewImages, hydrateMissionIcon } from '@/services/json-resource.service';
import type { ConfigFactionPreviewImages } from '@/domain/json-editor/json-config-records';

import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { invokeSaveCommand } from '@/shared/runtime/command.runtime';

export function saveModInfo(
  sessionId: string,
  modRoot: string,
  data: RowData,
  jsonWrite: JsonWriteOptions,
  baseVersions: import('@/shared/types').FileVersion[] = [],
  original?: RowData,
  request?: import('@/shared/runtime/command.runtime').SaveCommandRequest,
): Promise<WriteResult> {
  return invokeSaveCommand(
    'save_mod_info',
    {
      payload: { baseVersions, sessionId, modRoot, data, jsonWrite, orderedJson: JSON.stringify(data) } satisfies ModInfoSave,
    },
    original === undefined ? [{ kind: 'set', path: [], value: data }] : captureSaveEdits(original, data),
    request,
  );
}

export function saveIndexedConfigEntity(
  write: Omit<IndexedConfigSave, 'jsonWrite' | 'orderedJson'>,
  jsonWrite?: JsonWriteOptions,
  original?: RowData,
  request?: import('@/shared/runtime/command.runtime').SaveCommandRequest,
): Promise<WriteResult> {
  return invokeSaveCommand(
    'save_indexed_config_entity',
    {
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
      } satisfies IndexedConfigSave,
    },
    original === undefined ? [{ kind: 'set', path: [], value: write.entityData }] : captureSaveEdits(original, write.entityData),
    request,
  );
}

export function createIndexedConfigEntity(
  write: Omit<IndexedConfigSave, 'jsonWrite' | 'orderedJson'>,
  request?: SaveCommandRequest,
): Promise<WriteResult> {
  return invokeSaveCommand('create_indexed_config_entity', { payload: { ...write } satisfies IndexedConfigSave }, [], request);
}

export function deleteIndexedConfigEntity(write: IndexedConfigDelete, request?: SaveCommandRequest): Promise<WriteResult> {
  return invokeSaveCommand('delete_indexed_config_entity', { payload: write satisfies IndexedConfigDelete }, [], request);
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
