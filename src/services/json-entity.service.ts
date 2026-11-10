import type { DocumentEdit } from '@/shared/types';
import { invokeSaveCommand, type SaveCommandRequest } from '@/shared/runtime/command.runtime';
import { querySessionEntityEditTarget, querySessionEntityIdentityIntent } from './entity-query.service';
import { querySessionDraftResources } from './resource-reference.service';
import { hydrateFactionPreviewImages, hydrateMissionIcon } from './json-resource.service';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import type { ConfigFactionPreviewImages } from '@/domain/json-editor/json-config-records';
import type { JsonFileContent } from '@/shared/types';
import type {
  ModInfoSave,
  IndexedConfigSave,
  IndexedConfigDelete,
  IndexedConfigEntityRefresh,
  WriteResult,
  EntityKind,
  EntityTargetSnapshot,
  EntityIdentityIntent,
  ProjectSessionId,
  RowData,
} from '@/shared/types';

export function saveModInfo(
  payload: ModInfoSave,
  edits: DocumentEdit[],
  request?: SaveCommandRequest,
): Promise<WriteResult<JsonFileContent>> {
  return invokeSaveCommand('save_mod_info', { payload }, edits, request);
}
export function saveIndexedConfigEntity(
  payload: IndexedConfigSave,
  edits: DocumentEdit[],
  request?: SaveCommandRequest,
): Promise<WriteResult<IndexedConfigEntityRefresh>> {
  return invokeSaveCommand('save_indexed_config_entity', { payload }, edits, request);
}
export function createIndexedConfigEntity(
  payload: IndexedConfigSave,
  request?: SaveCommandRequest,
): Promise<WriteResult<IndexedConfigEntityRefresh>> {
  return invokeSaveCommand('create_indexed_config_entity', { payload }, [], request);
}
export function deleteIndexedConfigEntity(payload: IndexedConfigDelete, request?: SaveCommandRequest): Promise<WriteResult> {
  return invokeSaveCommand('delete_indexed_config_entity', { payload }, [], request);
}
export async function captureConfigIdentityIntent(sessionId: string, kind: EntityKind, sourceId: string, nextId: string) {
  const snapshot = cloneQuerySnapshot<EntityTargetSnapshot>(await querySessionEntityEditTarget(sessionId, kind, sourceId));
  const intent = cloneQuerySnapshot<EntityIdentityIntent>(await querySessionEntityIdentityIntent(sessionId, snapshot.target, nextId));
  return { snapshot, intent };
}
export async function queryFactionPreviewImages(
  sessionId: ProjectSessionId,
  id: string,
  draft: RowData,
  signal?: AbortSignal,
): Promise<ConfigFactionPreviewImages> {
  return hydrateFactionPreviewImages(sessionId, await querySessionDraftResources(sessionId, 'faction', id, draft, signal), signal);
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
