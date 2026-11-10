import { miscConfigDefinition } from '@/domain/misc-config';
import { projectJsonValue } from '@/domain/json-document';
import { prepareJsonWrite } from '@/domain/schema/game-number';
import { saveModInfo } from '@/services/json-entity.service';
import {
  jsonDocumentRecord,
  jsonDocumentValue,
  jsonDocumentId,
  jsonDocumentContent,
  miscConfigDocumentValue,
  type ConfigDocumentTarget,
  type JsonDocumentDefinition,
} from '@/domain/json-editor/json-document-definitions';
import {
  buildFactionIndexRow,
  buildMissionIndexRow,
  createDefaultFaction,
  configMissionSaveDraft,
} from '@/domain/json-editor/json-config-entities';
import { isEntityId, entityIdInvalidMessage } from '@/domain/schema/schema-identity';
import { takeReplaceBase } from '@/domain/json-composition';
import { queryMiscConfigFile, saveMiscConfig, deleteMiscConfig } from '@/services/misc-config.service';
import { prepareJsonSourceRecovery } from '@/services/json-recovery.service';
import { querySessionEntity } from '@/services/entity-query.service';
import { readJsonDocument, deleteVariantEntity, deleteSkinEntity } from '@/services/json-file.service';
import { deleteIndexedConfigEntity } from '@/services/json-entity.service';
import {
  saveIndexedEntityAction,
  saveJsonFileAction,
  createIndexedEntityAction,
  createJsonFileAction,
} from '@/orchestrators/json-save.orchestrator';
import { AppError } from '@/shared/lib/errors';
import { requireRowData } from '@/shared/lib/row-data';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import type { EditTargetSnapshot } from '@/app/composables/use-edit-target-draft-session';
import type { FileSchema } from '@/domain/schema/schema.types';
import type { DocumentSaveCapture } from '@/domain/json-document';
import type { SaveCommandRequest } from '@/shared/runtime/command.runtime';
import type { JsonFileContent } from '@/shared/types';
import type {
  AppFeedback,
  FileVersion,
  JsonComposition,
  JsonRecoveryPlan,
  ResourceRef,
  RowData,
  WriteResult,
  IndexedConfigSave,
} from '@/shared/types';

export type JsonDocumentWriter = (
  target: ConfigDocumentTarget,
  draft: RowData,
  versions: FileVersion[],
  original: RowData,
  capture: DocumentSaveCapture,
  request?: SaveCommandRequest,
) => Promise<JsonDocumentSnapshot | void>;

export interface JsonDocumentMeta {
  document: JsonFileContent;
  composition?: JsonComposition;
  resources?: Record<string, ResourceRef>;
  receipt: WriteResult<unknown> | null;
  recovery?: JsonRecoveryPlan;
}
export type JsonDocumentSnapshot = EditTargetSnapshot<RowData, ConfigDocumentTarget, JsonDocumentMeta>;

export async function loadJsonDocument(target: ConfigDocumentTarget, signal?: AbortSignal): Promise<JsonDocumentSnapshot> {
  const { sessionId, kind } = target;
  if (kind === 'mod-info') {
    const file = await readJsonDocument(sessionId, 'mod_info.json');
    if (!file) throw new AppError('Mod 信息来源已删除', { code: 'json.source_missing' });
    return {
      target,
      value: jsonDocumentValue(kind, requireRowData(projectJsonValue(file.document.content), 'Mod 信息内容无效')),
      baseVersions: file.baseVersions,
      meta: { document: file.document, receipt: null },
    };
  }
  if (kind === 'misc-config') {
    const file = await queryMiscConfigFile(sessionId, target.modRoot, miscConfigDefinition(target.id).kind, signal);
    if (!file) throw new AppError('杂项配置来源已删除', { code: 'json.source_missing' });
    const document = cloneQuerySnapshot<JsonFileContent>(file.document);
    return {
      target,
      value: miscConfigDocumentValue(projectJsonValue(document.content)),
      baseVersions: [...file.baseVersions],
      meta: { document, composition: cloneQuerySnapshot<JsonComposition>(file.composition), receipt: null },
    };
  }
  const entity = await querySessionEntity(sessionId, kind, target.id, signal);
  if (!entity) throw new AppError('JSON 文档来源已删除', { code: 'json.source_missing' });
  const record = jsonDocumentRecord(sessionId, target.modRoot, entity);
  return {
    target: record.target,
    value: record.value,
    baseVersions: record.baseVersions,
    meta: { document: record.document!, resources: record.resources, composition: record.composition, receipt: null },
  };
}

export async function saveJsonDocument(
  definition: JsonDocumentDefinition,
  schema: FileSchema,
  feedback: AppFeedback,
  target: ConfigDocumentTarget,
  data: RowData,
  baseVersions: FileVersion[],
  original: RowData,
  capture: DocumentSaveCapture,
  request?: SaveCommandRequest,
  composition?: JsonComposition,
): Promise<JsonDocumentSnapshot | void> {
  const { kind } = definition,
    { sessionId, modRoot, id } = target;
  const replacement = takeReplaceBase(data, kind === 'variant' || kind === 'skin' ? [] : ['file']);
  const replacePaths = replacement.replace ? [kind === 'misc-config' ? miscConfigDefinition(id).path : target.entity!.write.relPath] : [];
  if (replacement.replace && composition) composition = { ...composition, replace: true };
  const jsonWrite = { preserveStructure: capture.request.layout === 'preserveStructure', replacePaths };
  const document = capture.request;
  const nextId = jsonDocumentId(definition, data) || id;
  if (kind !== 'mod-info' && kind !== 'misc-config' && !isEntityId(nextId))
    throw new AppError(entityIdInvalidMessage(definition.idField, nextId), { code: 'config.id_invalid' });
  let receipt: WriteResult<unknown>, actual: JsonFileContent, value: RowData;
  if (kind === 'mod-info' || kind === 'misc-config') {
    const result =
      kind === 'mod-info'
        ? await saveModInfo({ sessionId, modRoot, baseVersions, document, jsonWrite }, capture.edits, request)
        : await saveMiscConfig(
            { sessionId, modRoot, kind: miscConfigDefinition(id).kind, baseVersions, document, jsonWrite },
            capture.edits,
            request,
          );
    receipt = result;
    actual = result.content!.value;
    value =
      kind === 'mod-info'
        ? jsonDocumentValue(kind, requireRowData(projectJsonValue(actual.content), 'Mod 信息内容无效'))
        : miscConfigDocumentValue(projectJsonValue(actual.content));
  } else if (kind === 'variant' || kind === 'skin') {
    const result = await saveJsonFileAction(
      kind,
      { sessionId, modRoot, baseVersions, document, jsonWrite, previousId: id, nextId, relPath: target.entity!.write.relPath },
      capture.edits,
      feedback,
      { original, data, composition },
      request,
    );
    if (!result) return;
    receipt = result;
    actual = result.content!.value.document!;
    value = requireRowData(projectJsonValue(actual.content), 'JSON 文档内容无效');
  } else {
    const common = { sessionId, modRoot, baseVersions, previousId: id, nextId, document, jsonWrite };
    const mission = kind === 'mission' ? configMissionSaveDraft(data, schema) : null;
    const payload: IndexedConfigSave = mission
      ? {
          ...common,
          kind: 'mission',
          text: mission.text,
          indexRow: buildMissionIndexRow([mission.list], Object.keys(mission.list), nextId),
        }
      : { ...common, kind: 'faction', indexRow: buildFactionIndexRow(nextId) };
    const result = await saveIndexedEntityAction(
      payload,
      capture.edits,
      feedback,
      { original: jsonDocumentContent(kind, original), data: jsonDocumentContent(kind, data), composition },
      request,
    );
    if (!result) return;
    receipt = result;
    actual = result.content!.value.document!;
    value =
      kind === 'faction'
        ? jsonDocumentValue(kind, requireRowData(projectJsonValue(actual.content), '势力内容无效'))
        : jsonDocumentValue(kind, {
            ...result.content!.value.entityData!,
            list: result.content!.value.indexRows.find((row) => !row.isComment && row.data.mission === nextId)!.data,
          });
  }
  const entity =
    kind === 'mod-info' || kind === 'misc-config'
      ? null
      : (receipt.identityChanges.find((change) => change.before.kind === kind && change.before.id === id)?.after ?? target.entity);
  if (entity && entity.write.relPath !== target.entity!.write.relPath) {
    const record = await querySessionEntity(sessionId, entity.kind, entity.id);
    composition = record?.composition ? cloneQuerySnapshot<JsonComposition>(record.composition) : undefined;
  }
  return {
    target: { ...target, id: nextId, entity },
    value,
    baseVersions: receipt.baseVersions,
    requestId: receipt.requestId,
    meta: { document: actual, composition, receipt },
  };
}

export async function createJsonDocument(
  definition: JsonDocumentDefinition,
  target: ConfigDocumentTarget,
  id: string,
  companion: string,
  request?: SaveCommandRequest,
) {
  const { kind } = definition,
    { sessionId, modRoot } = target;
  if (kind === 'misc-config') {
    const file = miscConfigDefinition(id);
    const plan = await prepareJsonSourceRecovery({ sessionId, modRoot, origin: { kind: 'miscConfig', file: file.kind } });
    return saveMiscConfig(
      { sessionId, modRoot, kind: file.kind, baseVersions: plan.baseVersions, document: prepareJsonWrite(file.initial), jsonWrite: {} },
      [],
      request,
    );
  }
  if (!isEntityId(id)) throw new AppError(entityIdInvalidMessage(definition.idField, id), { code: 'config.id_invalid' });
  if (kind === 'variant' || kind === 'skin') return createJsonFileAction(kind, sessionId, modRoot, companion, id, request);
  const common = { sessionId, modRoot, previousId: null, nextId: id, baseVersions: [], jsonWrite: {} };
  return createIndexedEntityAction(
    kind === 'faction'
      ? { ...common, kind, indexRow: buildFactionIndexRow(id), document: prepareJsonWrite(createDefaultFaction(id)) }
      : {
          ...common,
          kind: 'mission',
          indexRow: buildMissionIndexRow([], ['mission'], id),
          document: prepareJsonWrite({ title: id }),
          text: '',
        },
    request,
  );
}

export function deleteJsonDocument(
  target: ConfigDocumentTarget,
  baseVersions: FileVersion[],
  deleteSource: boolean,
  request?: SaveCommandRequest,
) {
  const { sessionId, modRoot, id, kind } = target;
  if (kind === 'misc-config') return deleteMiscConfig({ sessionId, modRoot, kind: miscConfigDefinition(id).kind, baseVersions }, request);
  if (kind === 'variant' || kind === 'skin')
    return (kind === 'variant' ? deleteVariantEntity : deleteSkinEntity)(
      { sessionId, modRoot, entityId: id, relPath: target.entity!.write.relPath, baseVersions },
      request,
    );
  return deleteIndexedConfigEntity(
    { sessionId, modRoot, kind: kind as 'faction' | 'mission', id, deleteTarget: deleteSource, baseVersions },
    request,
  );
}
