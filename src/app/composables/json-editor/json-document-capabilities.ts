import type { SaveCommandRequest } from '@/shared/runtime/command.runtime';
import { miscConfigFile, miscConfigValue, miscConfigContent } from '@/domain/json-editor/misc-config-files';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { queryMiscConfigFile, saveMiscConfig, deleteMiscConfig } from '@/services/misc-config.service';
import { prepareJsonSourceRecovery } from '@/services/json-recovery.service';
import { deleteIndexedConfigEntity } from '@/services/json-entity.service';
import { deleteVariantEntity, deleteSkinEntity } from '@/services/json-file.service';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import type { FileSchema } from '@/domain/schema/schema.types';
import { useProjectStore } from '@/stores/project.store';
import { querySessionEntity } from '@/services/entity-query.service';
import { entityIdInvalidMessage, isEntityId, entityRenameContext } from '@/domain/project/entity-definitions';
import { AppError } from '@/shared/lib/errors';
import {
  jsonDocumentRecord,
  jsonDocumentValue,
  jsonDocumentId,
  type ConfigDocumentTarget,
  type JsonDocumentDefinition,
} from '@/domain/json-editor/json-document-definitions';
import {
  configModInfoSaveData,
  configFactionSaveDraft,
  configMissionSaveDraft,
  buildFactionIndexRow,
  buildMissionIndexRow,
  createDefaultFaction,
} from '@/domain/json-editor/json-config-entities';
import {
  saveModInfoAction,
  saveIndexedEntityAction,
  saveJsonFileAction,
  createIndexedEntityAction,
  createJsonFileAction,
} from '@/orchestrators/json-save.orchestrator';
import type { EditTargetSnapshot } from '@/app/composables/use-edit-target-draft-session';
import type { AppFeedback, FileVersion, JsonRecoveryPlan, JsonValue, RowData, WriteResult } from '@/shared/types';

export interface JsonDocumentMeta {
  resources?: Record<string, import('@/shared/types').ResourceRef>;
  receipt: WriteResult<unknown> | null;
  recovery?: JsonRecoveryPlan;
}
export type JsonDocumentSnapshot = EditTargetSnapshot<RowData, ConfigDocumentTarget, JsonDocumentMeta>;

export async function loadJsonDocument(target: ConfigDocumentTarget, signal?: AbortSignal): Promise<JsonDocumentSnapshot> {
  const kind = target.kind;
  if (kind === 'misc-config') {
    const file = await queryMiscConfigFile(target.sessionId, target.modRoot, miscConfigFile(target.id).kind, signal);
    if (!file) throw new AppError('杂项配置来源已删除', { code: 'json.source_missing' });
    return {
      target,
      value: miscConfigValue(target.id, cloneQuerySnapshot<JsonValue>(file.data)),
      baseVersions: [...file.baseVersions],
      meta: { receipt: null },
    };
  }
  if (kind === 'mod-info') {
    const manifest = useProjectStore().getManifest(target.modRoot)!;
    return {
      target,
      value: jsonDocumentValue(kind, manifest.modInfo ?? {}),
      baseVersions: manifest.baseVersions,
      meta: { receipt: null },
    };
  }
  const entity = await querySessionEntity(target.sessionId, kind, target.id, signal);
  if (!entity) throw new AppError('JSON 文档来源已删除', { action: 'read-json-document', code: 'json.source_missing' });
  const record = jsonDocumentRecord(target.sessionId, target.modRoot, entity);
  return { ...record, meta: { receipt: null, resources: record.resources } };
}

export async function saveJsonDocument(
  definition: JsonDocumentDefinition,
  schema: FileSchema,
  feedback: AppFeedback,
  target: ConfigDocumentTarget,
  data: RowData,
  baseVersions: FileVersion[],
  original: RowData,
  request?: import('@/shared/runtime/command.runtime').SaveCommandRequest,
): Promise<JsonDocumentSnapshot | void> {
  const { kind, file } = definition;
  const { sessionId, modRoot, id } = target;
  if (kind === 'misc-config') {
    const content = miscConfigContent(id, data);
    const receipt = await runConfirmedJsonWrite(feedback, (jsonWrite) =>
      saveMiscConfig(
        {
          sessionId,
          modRoot,
          kind: miscConfigFile(id).kind,
          baseVersions,
          data: content,
          jsonWrite,
          orderedJson: JSON.stringify(content),
        },
        miscConfigContent(id, original),
        request,
      ),
    );
    if (!receipt) return;
    return {
      target,
      value: miscConfigValue(id, receipt.content!.value),
      baseVersions: receipt.baseVersions,
      meta: { receipt },
      requestId: receipt.requestId,
    };
  }
  const nextId = jsonDocumentId(definition, data);
  if (kind !== 'mod-info' && !isEntityId(nextId))
    throw new AppError(entityIdInvalidMessage(definition.idField, nextId), { action: 'save-json-document', code: 'config.id_invalid' });
  let value: RowData;
  let receipt: WriteResult<unknown>;
  if (kind === 'mod-info') {
    const result = await saveModInfoAction(
      sessionId,
      modRoot,
      configModInfoSaveData(data, schema),
      feedback,
      baseVersions,
      configModInfoSaveData(original, schema),
      request,
    );
    if (!result) return;
    receipt = result;
    value = jsonDocumentValue(kind, result.content?.value as RowData);
  } else if (kind === 'variant' || kind === 'skin') {
    if (!String(data[file!.companionField] ?? '').trim())
      throw new AppError(file!.companionField + ' 不能为空', { action: 'save-json-document', code: 'config.missing_field' });
    const result = await saveJsonFileAction(
      kind,
      sessionId,
      modRoot,
      nextId,
      data,
      entityRenameContext(id, nextId).previousId,
      target.entity!.write.relPath,
      feedback,
      baseVersions,
      original,
      request,
    );
    if (!result) return;
    receipt = result.receipt;
    value = result.entity.data;
  } else {
    const draft = kind === 'faction' ? configFactionSaveDraft(data, schema) : configMissionSaveDraft(data, schema);
    const result = await saveIndexedEntityAction(
      {
        sessionId,
        modRoot,
        kind,
        previousId: id,
        nextId,
        baseVersions,
        indexRow: 'file' in draft ? buildFactionIndexRow(nextId) : buildMissionIndexRow([draft.list], Object.keys(draft.list), nextId),
        entityData: 'file' in draft ? { file: draft.file } : { descriptor: draft.descriptor, text: draft.text },
      },
      feedback,
      kind === 'faction' ? { file: original.file! } : { descriptor: original.descriptor!, text: original.text! },
      request,
    );
    if (!result) return;
    receipt = result.receipt;
    value =
      kind === 'faction'
        ? result.entity.entityData!
        : {
            ...result.entity.entityData!,
            list: result.entity.indexRows.find((row) => !row.isComment && row.data.mission === nextId)!.data,
          };
    value = kind === 'faction' ? value : jsonDocumentValue(kind, value);
  }
  const entity =
    kind === 'mod-info' ? null : receipt.identityChanges.find((change) => change.before.kind === kind && change.before.id === id)!.after;
  return {
    target: { ...target, id: kind === 'mod-info' ? id : nextId, entity },
    value,
    baseVersions: receipt.baseVersions,
    meta: { receipt },
    requestId: receipt.requestId,
  };
}

export async function createJsonDocument(
  definition: JsonDocumentDefinition,
  target: ConfigDocumentTarget,
  id: string,
  companion: string,
  request?: SaveCommandRequest,
) {
  const { kind, file } = definition;
  if (kind === 'misc-config') {
    const { sessionId, modRoot } = target;
    const { kind, initial } = miscConfigFile(id);
    const plan = await prepareJsonSourceRecovery({ sessionId, modRoot, origin: { kind: 'miscConfig', file: kind } });
    if (!plan.missingPaths.length) throw new AppError('文件已存在', { code: 'spec.target_exists' });
    return saveMiscConfig(
      {
        sessionId,
        modRoot,
        kind,
        baseVersions: plan.baseVersions,
        data: cloneQuerySnapshot(initial),
        jsonWrite: { preserveOriginalJson: true, confirmedSources: [] },
        orderedJson: JSON.stringify(initial),
      },
      undefined,
      request,
    );
  }
  if (!isEntityId(id))
    throw new AppError(entityIdInvalidMessage(definition.idField, id), { action: 'create-json-document', code: 'config.id_invalid' });
  const { sessionId, modRoot } = target;
  if (kind === 'variant' || kind === 'skin') {
    if (!companion)
      throw new AppError(file!.companionField + ' 不能为空', { action: 'create-json-document', code: 'config.missing_field' });
    return (await createJsonFileAction(kind, sessionId, modRoot, companion, id, request)).receipt;
  }
  return (
    await createIndexedEntityAction(
      {
        sessionId,
        modRoot,
        kind: kind as 'faction' | 'mission',
        previousId: null,
        nextId: id,
        baseVersions: [],
        indexRow: kind === 'faction' ? buildFactionIndexRow(id) : buildMissionIndexRow([], ['mission'], id),
        entityData: kind === 'faction' ? { file: createDefaultFaction(id) } : { descriptor: { title: id }, text: '' },
      },
      request,
    )
  ).receipt;
}

export function deleteJsonDocument(
  target: ConfigDocumentTarget,
  baseVersions: FileVersion[],
  deleteSource: boolean,
  request?: SaveCommandRequest,
) {
  const { sessionId, modRoot, id, entity, kind } = target;
  if (kind === 'misc-config') return deleteMiscConfig({ sessionId, modRoot, kind: miscConfigFile(id).kind, baseVersions }, request);
  if (kind === 'variant' || kind === 'skin') {
    const remove = kind === 'variant' ? deleteVariantEntity : deleteSkinEntity;
    return remove({ sessionId, modRoot, entityId: id, relPath: entity!.write.relPath, baseVersions }, request);
  }
  return deleteIndexedConfigEntity(
    { sessionId, modRoot, kind: kind as 'faction' | 'mission', id, deleteTarget: deleteSource, baseVersions },
    request,
  );
}
