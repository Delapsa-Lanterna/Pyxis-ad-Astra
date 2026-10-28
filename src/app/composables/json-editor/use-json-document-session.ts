import { useCoreSchema } from '@/app/composables/use-core-schema';
import { beginSavedWrite } from '@/orchestrators/project-sync.orchestrator';
import { releaseNativeWindowTargets } from '@/services/window.service';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { requireRowData } from '@/shared/lib/row-data';
import { miscConfigValue } from '@/domain/json-editor/misc-config-files';
import { observeSavedContent, saveProjection } from '@/orchestrators/project-sync.orchestrator';
import { computed, effectScope, onScopeDispose, ref, watch } from 'vue';
import { hasMiscConfigInvalidation } from '@/services/misc-config.service';
import { miscConfigFile } from '@/domain/json-editor/misc-config-files';
import { transferVariantWeaponSlots } from '@/domain/json-editor/json-variant-weapons';
import { useEditTargetDraftSession, type EditTargetDraftSessionOptions } from '@/app/composables/use-edit-target-draft-session';
import { useSnapshotHistory } from '@/app/composables/use-snapshot-history';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useJsonDocumentIdentity } from './use-json-document-identity';
import { useJsonSourceRecovery } from './use-json-source-recovery';
import { loadJsonDocument, saveJsonDocument, type JsonDocumentMeta } from './json-document-capabilities';
import {
  configDocumentKey,
  jsonDocumentId,
  jsonRecoveryValue,
  jsonDocumentOrigin,
  jsonDocumentValue,
  type ConfigDocumentTarget,
  type JsonDocumentDefinition,
  type JsonDocumentRecord,
} from '@/domain/json-editor/json-document-definitions';
import { useJsonEditorStore } from '@/stores/json-editor.store';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useSaveCommandStore, type SaveSessionHandle } from '@/stores/save-command.store';
import { useSettingsStore } from '@/stores/settings.store';

import { hasEntityInvalidation } from '@/services/entity-query.service';
import { relativePathFromRoot } from '@/shared/lib/paths';
import type { DocumentEditorActions, DocumentSaveResult } from '@/shared/runtime/document-editor';
import type { AppFeedback, RowData, WriteContent, JsonRecoveryPlan } from '@/shared/types';

export function useJsonDocumentSession(definition: JsonDocumentDefinition, record: JsonDocumentRecord, feedback: AppFeedback) {
  const editors = useJsonEditorStore();
  const { target } = record;
  return editors.retainDocument(configDocumentKey(target), target.sessionId, target.modRoot, () => {
    const scope = effectScope(true);
    const session = scope.run(() => createJsonDocumentSession(definition, record, feedback))!;
    let key = configDocumentKey(target);
    scope.run(() =>
      watch(
        session.targetKey,
        (next) => {
          if (next && next !== key) {
            editors.rekeyDocument(key, next);
            key = next;
          }
        },
        { flush: 'sync' },
      ),
    );
    return { value: { session }, dispose: () => scope.stop() };
  }).session;
}
function createJsonDocumentSession(definition: JsonDocumentDefinition, record: JsonDocumentRecord, feedback: AppFeedback) {
  const commands = useSaveCommandStore();
  const editors = useJsonEditorStore();
  const settings = useSettingsStore();
  const { getMergedSchema } = useCoreSchema();
  const schema = computed(() =>
    getMergedSchema(definition.kind === 'misc-config' ? miscConfigFile(record.target.id).schema : definition.kind)!,
  );
  const active = ref(false);
  const reads = useQueryReadOwner();
  const modRoot = computed(() => record.target.modRoot);
  const session = useEditTargetDraftSession<RowData, ConfigDocumentTarget, JsonDocumentMeta>({
    emptyValue: {},
    beginSave: beginSavedWrite,
    savedContent: (snapshot) => ({ ...snapshot, meta: { ...snapshot.meta, receipt: null, recovery: undefined } }),
    targetKey: configDocumentKey,
    load: loadJsonDocument,
    save: (target, draft, versions, original, request) =>
      saveJsonDocument(definition, schema.value, feedback, target, draft, versions, original, request),
    acceptSaved: async (snapshot) => {
      if (snapshot.meta.recovery) {
        recovery.accept(snapshot.meta.recovery);
      }
      await releaseNativeWindowTargets();
    },

    afterSaved: (snapshot) => {
      feedback.success(snapshot.meta.recovery ? 'JSON 来源已重新创建' : '当前 JSON 文档已保存');
    },
  });
  session.loadBaseForTarget({ ...record, meta: { receipt: null, resources: record.resources } });
  const history = useSnapshotHistory<RowData>(
    session.context,
    computed(() => settings.editHistoryLimit),
  );
  const identity = useJsonDocumentIdentity(
    session,
    active,
    history,
    definition.kind === 'mod-info' || definition.kind === 'misc-config'
      ? undefined
      : {
          kind: definition.kind,
          read: (target, id, signal) => loadJsonDocument({ ...target, id }, signal),
          map: (value, previous, next) => {
            if (jsonDocumentId(definition, value) !== previous) return value;
            const source = definition.kind === 'mission' ? 'list' : definition.kind === 'faction' ? 'file' : null;
            return source
              ? { ...value, [source]: { ...(value[source] as RowData), [definition.idField]: next } }
              : { ...value, [definition.idField]: next };
          },
        },
    feedback,
  );
  type Writer = EditTargetDraftSessionOptions<RowData, ConfigDocumentTarget, JsonDocumentMeta>['save'];
  async function saveActual(write?: Writer): Promise<DocumentSaveResult> {
    recovery.cancelRead();
    if (!write && !session.dirty.value && !session.saving.value) return { status: 'noop' };
    const snapshot = await session.saveDraft(write, Boolean(write));
    return snapshot ? { status: 'saved', receipt: snapshot.meta.receipt! } : { status: 'cancelled' };
  }
  const handle: SaveSessionHandle = {
    targetKey: session.currentTargetKey,
    modRoot,
    saving: session.saving,
    waitForSave: session.waitForSave,
    editing: {
      label: definition.label,
      dirty: session.dirty,
      draftSession: session,
      targets: computed(() =>
        session.baselineSnapshot.value!.baseVersions.map((version) => ({
          sessionId: record.target.sessionId,
          modRoot: record.target.modRoot,
          path: version.path,
        })),
      ),
      save: () => saveActual(),
    },
  };
  const save = (write?: Writer) => commands.requestSave(handle, () => saveActual(write));
  const recovery = useJsonSourceRecovery({ session, active, save, feedback });
  const { confirmDiscard } = useFieldInputActions(session.inputs, feedback);
  function setDraft(value: RowData) {
    recovery.cancelRead();
    if (definition.kind === 'variant' && settings.editMode === 'smart') value = transferVariantWeaponSlots(session.draftValue.value, value);
    history.push(session.draftValue.value, value);
    session.setDraft(value);
  }
  async function replay(direction: 'undo' | 'redo') {
    const committed = session.inputs.commit();
    if (committed && !(await committed)) return false;
    if (!(direction === 'undo' ? history.canUndo.value : history.canRedo.value)) return null;
    session.inputs.cancel();
    recovery.cancelRead();
    session.setDraft(history[direction]()!);
    return true;
  }
  async function refresh() {
    const target = session.currentTarget.value!;
    const plan = await recovery.refresh();
    if (plan && active.value && !recovery.missing.value && !identity.pending.value)
      session.applyExternalForTarget({
        target,
        value: jsonRecoveryValue(target, plan, session.baselineSnapshot.value!.value),
        baseVersions: plan.baseVersions,
        meta: { receipt: null, resources: plan.resourceRefs },
      });
  }
  const actions: DocumentEditorActions<ConfigDocumentTarget> = {
    target: session.currentTarget,
    targetKey: session.currentTargetKey,
    inputs: session.inputs,
    dirty: session.dirty,
    saving: computed(() => session.saving.value || commands.isSaveQueued(handle)),
    canUndo: computed(() => history.canUndo.value || session.inputs.dirty.value),
    canRedo: computed(() => history.canRedo.value || session.inputs.dirty.value),
    undo: () => replay('undo'),
    redo: () => replay('redo'),
    save: () => save(),
    waitForSave: () => commands.waitForSession(handle),
  };
  const editor = actions;
  function setActive(enabled: boolean, fresh = false) {
    if (enabled === active.value) return;
    active.value = enabled;
    if (enabled) {
      editors.activate(editor);
      if (!fresh) void refresh().catch((error) => feedback.error(error, '刷新 JSON 文档失败'));
    } else {
      editors.deactivate(editor);
      session.cancelRead();
      reads.revoke();
    }
  }
  watch(
    session.currentTarget,
    (next, before) => {
      if (next && before && next.id !== before.id) {
        const selected = editors.selection(next.sessionId, definition.kind);
        if (selected.value === before.id) selected.value = next.id;
      }
    },
    { flush: 'sync' },
  );
  onScopeDispose(useDraftSessionsStore().registerDraftSession(modRoot, session.dirty));
  onScopeDispose(commands.registerSaveSession(handle));
  onScopeDispose(
    observeSavedContent(
      (event) => {
        const projection = saveProjection(event, record.target?.sessionId);
        if (!projection) return;
        if (projection.manifest.sessionId !== record.target.sessionId) return;

        const target = session.currentTarget.value!;
        const receipt = event.reason === 'refresh' ? null : event.result;
        if (receipt && !session.acceptsSaveDelivery(target, receipt.requestId)) return;
        if (
          receipt?.identityChanges.some(
            (change) => change.after.kind === target.kind && change.after.id === target.id && change.before.id !== change.after.id,
          )
        )
          return;
        const content = receipt?.content;
        if (
          content &&
          (content.target.kind === 'json' || content.target.kind === 'recovery') &&
          stableDeepEqual(content.target.origin, jsonDocumentOrigin(target))
        ) {
          if (content.target.kind === 'recovery') {
            const plan = (content as WriteContent<JsonRecoveryPlan>).value;
            session.applyExternalForTarget(
              {
                target,
                value: jsonRecoveryValue(target, plan, session.baselineSnapshot.value!.value),
                baseVersions: receipt!.baseVersions,
                requestId: receipt!.requestId,
                meta: { receipt: null, resources: plan.resourceRefs },
              },
              true,
            );
            return;
          }
          if (target.kind === 'mod-info' || target.kind === 'misc-config') {
            const value =
              target.kind === 'misc-config'
                ? miscConfigValue(target.id, content.value as import('@/shared/types').JsonValue)
                : jsonDocumentValue(target.kind, requireRowData(content.value, 'JSON 文档内容无效'));
            session.applyExternalForTarget(
              {
                target,
                value,
                baseVersions: receipt!.baseVersions,
                requestId: receipt!.requestId,
                meta: { receipt: null },
              },
              true,
            );
            return;
          }
        }
        if (
          definition.kind !== 'mod-info' &&
          !(definition.kind === 'misc-config'
            ? hasMiscConfigInvalidation(projection.invalidation, record.target.modRoot, miscConfigFile(record.target.id).kind)
            : hasEntityInvalidation(projection.invalidation, 'entity-detail', definition.kind, session.currentTarget.value!.id))
        )
          return;
        if (active.value)
          return refresh().catch((error) => {
            feedback.error(error, '刷新 JSON 文档失败');
            throw error;
          });
      },
      (sessionId) => {
        if (sessionId === record.target.sessionId) {
          session.cancelRead();
          reads.revoke('session');
        }
      },
    ),
  );
  onScopeDispose(() => {
    editors.deactivate(editor);
    history.dispose();
    session.dispose();
  });
  return {
    viewId: configDocumentKey(record.target),
    ...actions,
    active,
    setActive,
    externalUpdateNotice: session.externalUpdateNotice,
    schema,
    draftValue: computed({ get: () => session.draftValue.value, set: setDraft }),
    sourceTarget: computed(() => identity.pending.value?.snapshot.target ?? session.currentTarget.value!),
    sourceMissing: recovery.missing,
    recreateSources: recovery.recreate,
    handoffLocked: computed(() => false),
    record: computed<JsonDocumentRecord>(() => ({
      target: session.currentTarget.value!,
      value: session.baselineSnapshot.value!.value,
      baseVersions: session.baselineSnapshot.value!.baseVersions,
      resources: session.baselineSnapshot.value!.meta.resources ?? record.resources,
    })),
    paths: computed(() =>
      session.baselineSnapshot.value!.baseVersions.map((version) => relativePathFromRoot(record.target.modRoot, version.path)).join(' · '),
    ),
    loadPendingExternal: async () => {
      if (await actions.waitForSave())
        confirmDiscard(session.loadPendingExternal, session.dirty.value, () => session.currentTargetKey.value);
    },
  };
}
export type JsonDocumentSession = ReturnType<typeof useJsonDocumentSession>;
