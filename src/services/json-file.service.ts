import type { SaveCommandRequest } from '@/shared/runtime/command.runtime';
import { captureSaveEdits } from '@/domain/project/save-edits';
import type { RowData } from '@/shared/types';
import type { VariantFile, SkinFile, JsonFileSave, JsonFileDelete, JsonWriteOptions, WriteResult } from '@/shared/types';
import { invokeSaveCommand } from '@/shared/runtime/command.runtime';

export function saveVariantEntity(
  write: Omit<JsonFileSave, 'jsonWrite' | 'orderedJson'>,
  jsonWrite?: JsonWriteOptions,
  original?: RowData,
  request?: import('@/shared/runtime/command.runtime').SaveCommandRequest,
): Promise<WriteResult<VariantFile>> {
  return invokeSaveCommand(
    'save_variant_entity',
    {
      payload: { ...write, ...(jsonWrite ? { jsonWrite, orderedJson: JSON.stringify(write.data) } : {}) } satisfies JsonFileSave,
    },
    original === undefined ? [{ kind: 'set', path: [], value: write.data }] : captureSaveEdits(original, write.data),
    request,
  );
}

export function createVariantEntity(
  write: Omit<JsonFileSave, 'jsonWrite' | 'orderedJson'>,
  request?: SaveCommandRequest,
): Promise<WriteResult<VariantFile>> {
  return invokeSaveCommand('create_variant_entity', { payload: write satisfies JsonFileSave }, [], request);
}

export function deleteVariantEntity(write: JsonFileDelete, request?: SaveCommandRequest): Promise<WriteResult> {
  return invokeSaveCommand('delete_variant_entity', { payload: write satisfies JsonFileDelete }, [], request);
}

export function saveSkinEntity(
  write: Omit<JsonFileSave, 'jsonWrite' | 'orderedJson'>,
  jsonWrite?: JsonWriteOptions,
  original?: RowData,
  request?: import('@/shared/runtime/command.runtime').SaveCommandRequest,
): Promise<WriteResult<SkinFile>> {
  return invokeSaveCommand(
    'save_skin_entity',
    {
      payload: { ...write, ...(jsonWrite ? { jsonWrite, orderedJson: JSON.stringify(write.data) } : {}) } satisfies JsonFileSave,
    },
    original === undefined ? [{ kind: 'set', path: [], value: write.data }] : captureSaveEdits(original, write.data),
    request,
  );
}

export function createSkinEntity(
  write: Omit<JsonFileSave, 'jsonWrite' | 'orderedJson'>,
  request?: SaveCommandRequest,
): Promise<WriteResult<SkinFile>> {
  return invokeSaveCommand('create_skin_entity', { payload: write satisfies JsonFileSave }, [], request);
}

export function deleteSkinEntity(write: JsonFileDelete, request?: SaveCommandRequest): Promise<WriteResult> {
  return invokeSaveCommand('delete_skin_entity', { payload: write satisfies JsonFileDelete }, [], request);
}
