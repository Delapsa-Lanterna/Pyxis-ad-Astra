import type {
  VariantFile,
  SkinFile,
  ConfigFamilyEntityPayload,
  DeleteConfigFamilyEntityPayload,
  JsonWriteOptions,
  ProjectSessionId,
  WriteResult,
} from '@/shared/types';
import { querySessionEntity, querySessionEntityList } from '@/services/entity-query.service';
import { toConfigFamilyRecord } from '@/domain/config/config-records';
import { invokeCommand } from '@/shared/runtime/command.runtime';

export function saveVariantEntity(
  write: Omit<ConfigFamilyEntityPayload, 'jsonWrite' | 'orderedJson'>,
  jsonWrite?: JsonWriteOptions,
): Promise<WriteResult<VariantFile>> {
  return invokeCommand('save_variant_entity', {
    payload: { ...write, ...(jsonWrite ? { jsonWrite, orderedJson: JSON.stringify(write.data) } : {}) } satisfies ConfigFamilyEntityPayload,
  });
}

export function createVariantEntity(
  write: Omit<ConfigFamilyEntityPayload, 'jsonWrite' | 'orderedJson'>,
): Promise<WriteResult<VariantFile>> {
  return invokeCommand('create_variant_entity', { payload: write satisfies ConfigFamilyEntityPayload });
}

export function deleteVariantEntity(write: DeleteConfigFamilyEntityPayload): Promise<WriteResult> {
  return invokeCommand('delete_variant_entity', { payload: write satisfies DeleteConfigFamilyEntityPayload });
}

export function saveSkinEntity(
  write: Omit<ConfigFamilyEntityPayload, 'jsonWrite' | 'orderedJson'>,
  jsonWrite?: JsonWriteOptions,
): Promise<WriteResult<SkinFile>> {
  return invokeCommand('save_skin_entity', {
    payload: { ...write, ...(jsonWrite ? { jsonWrite, orderedJson: JSON.stringify(write.data) } : {}) } satisfies ConfigFamilyEntityPayload,
  });
}

export function createSkinEntity(write: Omit<ConfigFamilyEntityPayload, 'jsonWrite' | 'orderedJson'>): Promise<WriteResult<SkinFile>> {
  return invokeCommand('create_skin_entity', { payload: write satisfies ConfigFamilyEntityPayload });
}

export function deleteSkinEntity(write: DeleteConfigFamilyEntityPayload): Promise<WriteResult> {
  return invokeCommand('delete_skin_entity', { payload: write satisfies DeleteConfigFamilyEntityPayload });
}

export async function listVariantRecords(sessionId: ProjectSessionId, signal?: AbortSignal) {
  const entities = await querySessionEntityList(sessionId, 'variant', signal);
  return entities.map(toConfigFamilyRecord);
}

export async function getConfigFamilyRecord(sessionId: string, kind: 'variant' | 'skin', id: string, signal?: AbortSignal) {
  const entity = await querySessionEntity(sessionId, kind, id, signal);
  return entity ? toConfigFamilyRecord(entity) : null;
}

export async function listSkinRecords(sessionId: ProjectSessionId, signal?: AbortSignal) {
  const entities = await querySessionEntityList(sessionId, 'skin', signal);
  return entities.map(toConfigFamilyRecord);
}
