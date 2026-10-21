import type {
  VariantFile,
  SkinFile,
  JsonEntityFilePayload,
  DeleteJsonEntityFilePayload,
  JsonWriteOptions,
  WriteResult,
} from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';

export function saveVariantEntity(
  write: Omit<JsonEntityFilePayload, 'jsonWrite' | 'orderedJson'>,
  jsonWrite?: JsonWriteOptions,
): Promise<WriteResult<VariantFile>> {
  return invokeCommand('save_variant_entity', {
    payload: { ...write, ...(jsonWrite ? { jsonWrite, orderedJson: JSON.stringify(write.data) } : {}) } satisfies JsonEntityFilePayload,
  });
}

export function createVariantEntity(write: Omit<JsonEntityFilePayload, 'jsonWrite' | 'orderedJson'>): Promise<WriteResult<VariantFile>> {
  return invokeCommand('create_variant_entity', { payload: write satisfies JsonEntityFilePayload });
}

export function deleteVariantEntity(write: DeleteJsonEntityFilePayload): Promise<WriteResult> {
  return invokeCommand('delete_variant_entity', { payload: write satisfies DeleteJsonEntityFilePayload });
}

export function saveSkinEntity(
  write: Omit<JsonEntityFilePayload, 'jsonWrite' | 'orderedJson'>,
  jsonWrite?: JsonWriteOptions,
): Promise<WriteResult<SkinFile>> {
  return invokeCommand('save_skin_entity', {
    payload: { ...write, ...(jsonWrite ? { jsonWrite, orderedJson: JSON.stringify(write.data) } : {}) } satisfies JsonEntityFilePayload,
  });
}

export function createSkinEntity(write: Omit<JsonEntityFilePayload, 'jsonWrite' | 'orderedJson'>): Promise<WriteResult<SkinFile>> {
  return invokeCommand('create_skin_entity', { payload: write satisfies JsonEntityFilePayload });
}

export function deleteSkinEntity(write: DeleteJsonEntityFilePayload): Promise<WriteResult> {
  return invokeCommand('delete_skin_entity', { payload: write satisfies DeleteJsonEntityFilePayload });
}
