import type { DocumentEdit } from '@/shared/types';
import { invokeCommand, invokeSaveCommand, type SaveCommandRequest } from '@/shared/runtime/command.runtime';
import type { JsonDocumentFile, JsonDocumentRead } from '@/shared/types';
import type { JsonFileSave, JsonFileDelete, VariantFile, SkinFile, WriteResult } from '@/shared/types';

export function readJsonDocument(sessionId: string, relPath: string): Promise<JsonDocumentFile | null> {
  return invokeCommand('read_json_document', { payload: { sessionId, relPath } satisfies JsonDocumentRead });
}

export function saveVariantEntity(
  payload: JsonFileSave,
  edits: DocumentEdit[],
  request?: SaveCommandRequest,
): Promise<WriteResult<VariantFile>> {
  return invokeSaveCommand('save_variant_entity', { payload }, edits, request);
}
export function createVariantEntity(payload: JsonFileSave, request?: SaveCommandRequest): Promise<WriteResult<VariantFile>> {
  return invokeSaveCommand('create_variant_entity', { payload }, [], request);
}
export function deleteVariantEntity(payload: JsonFileDelete, request?: SaveCommandRequest): Promise<WriteResult> {
  return invokeSaveCommand('delete_variant_entity', { payload }, [], request);
}
export function saveSkinEntity(payload: JsonFileSave, edits: DocumentEdit[], request?: SaveCommandRequest): Promise<WriteResult<SkinFile>> {
  return invokeSaveCommand('save_skin_entity', { payload }, edits, request);
}
export function createSkinEntity(payload: JsonFileSave, request?: SaveCommandRequest): Promise<WriteResult<SkinFile>> {
  return invokeSaveCommand('create_skin_entity', { payload }, [], request);
}
export function deleteSkinEntity(payload: JsonFileDelete, request?: SaveCommandRequest): Promise<WriteResult> {
  return invokeSaveCommand('delete_skin_entity', { payload }, [], request);
}
