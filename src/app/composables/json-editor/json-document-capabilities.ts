import { computed } from 'vue';
import { useCoreSchema } from '@/app/composables/use-core-schema';
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
  saveVariantAction,
  saveSkinAction,
  createIndexedEntityAction,
  createVariantAction,
  createSkinAction,
  deleteIndexedEntityAction,
  deleteVariantAction,
  deleteSkinAction,
} from '@/orchestrators/json-save.orchestrator';
import type { EditTargetSnapshot } from '@/app/composables/use-edit-target-draft-session';
import type { AppFeedback, FileVersion, JsonRecoveryPlan, RowData, WriteResult } from '@/shared/types';

export interface JsonDocumentMeta {
  resources?: Record<string, import('@/shared/types').ResourceRef>;
  receipt: WriteResult<unknown> | null;
  recovery?: JsonRecoveryPlan;
}
export type JsonDocumentSnapshot = EditTargetSnapshot<RowData, ConfigDocumentTarget, JsonDocumentMeta>;

export function jsonDocumentCapabilities(definition: JsonDocumentDefinition, feedback: AppFeedback) {
  const project = useProjectStore();
  const { getMergedSchema } = useCoreSchema();
  const { kind, file } = definition;
  const schema = computed(() => getMergedSchema(kind)!);
  async function load(target: ConfigDocumentTarget, signal?: AbortSignal): Promise<JsonDocumentSnapshot> {
    if (kind === 'mod-info') {
      const manifest = project.getManifest(target.modRoot)!;
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
  async function save(target: ConfigDocumentTarget, data: RowData, baseVersions: FileVersion[]): Promise<JsonDocumentSnapshot | void> {
    const { sessionId, modRoot, id } = target;
    const nextId = jsonDocumentId(definition, data);
    if (kind !== 'mod-info' && !isEntityId(nextId))
      throw new AppError(entityIdInvalidMessage(definition.idField, nextId), { action: 'save-json-document', code: 'config.id_invalid' });
    let value: RowData;
    let receipt: WriteResult<unknown>;
    if (kind === 'mod-info') {
      const result = await saveModInfoAction(sessionId, modRoot, configModInfoSaveData(data, schema.value), feedback, baseVersions);
      if (!result) return;
      receipt = result;
      value = jsonDocumentValue(kind, result.refreshedEntity as RowData);
    } else if (kind === 'variant' || kind === 'skin') {
      if (!String(data[file!.companionField] ?? '').trim())
        throw new AppError(file!.companionField + ' 不能为空', { action: 'save-json-document', code: 'config.missing_field' });
      const result = await (kind === 'variant' ? saveVariantAction : saveSkinAction)(
        sessionId,
        modRoot,
        nextId,
        data,
        entityRenameContext(id, nextId).previousId,
        target.entity!.write.relPath,
        feedback,
        baseVersions,
      );
      if (!result) return;
      receipt = result.receipt;
      value = result.entity.data;
    } else {
      const draft = kind === 'faction' ? configFactionSaveDraft(data, schema.value) : configMissionSaveDraft(data, schema.value);
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
      commitId: receipt.commitId,
    };
  }
  async function create(target: ConfigDocumentTarget, id: string, companion: string) {
    if (!isEntityId(id))
      throw new AppError(entityIdInvalidMessage(definition.idField, id), { action: 'create-json-document', code: 'config.id_invalid' });
    const { sessionId, modRoot } = target;
    if (kind === 'variant' || kind === 'skin') {
      if (!companion)
        throw new AppError(file!.companionField + ' 不能为空', { action: 'create-json-document', code: 'config.missing_field' });
      return (await (kind === 'variant' ? createVariantAction : createSkinAction)(sessionId, modRoot, companion, id)).receipt;
    }
    return (
      await createIndexedEntityAction({
        sessionId,
        modRoot,
        kind: kind as 'faction' | 'mission',
        previousId: null,
        nextId: id,
        baseVersions: [],
        indexRow: kind === 'faction' ? buildFactionIndexRow(id) : buildMissionIndexRow([], ['mission'], id),
        entityData: kind === 'faction' ? { file: createDefaultFaction(id) } : { descriptor: { title: id }, text: '' },
      })
    ).receipt;
  }
  function remove(target: ConfigDocumentTarget, baseVersions: FileVersion[], deleteSource: boolean) {
    const { sessionId, modRoot, id, entity } = target;
    return kind === 'variant' || kind === 'skin'
      ? (kind === 'variant' ? deleteVariantAction : deleteSkinAction)(sessionId, modRoot, entity!.write.relPath, id, baseVersions)
      : deleteIndexedEntityAction(sessionId, modRoot, kind as 'faction' | 'mission', id, deleteSource, baseVersions);
  }
  return { schema, load, save, create, remove };
}
