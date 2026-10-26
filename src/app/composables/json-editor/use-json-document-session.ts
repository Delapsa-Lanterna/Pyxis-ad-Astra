import { computed, effectScope, onScopeDispose, ref, watch } from 'vue';
import { hasMiscConfigInvalidation } from '@/services/misc-config.service';
import { miscConfigFile } from '@/domain/json-editor/misc-config-files';
import { useEditTargetDraftSession, type EditTargetDraftSessionOptions } from '@/app/composables/use-edit-target-draft-session';
import { useSnapshotHistory } from '@/app/composables/use-snapshot-history';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useJsonDocumentIdentity } from './use-json-document-identity';
import { useJsonSourceRecovery } from './use-json-source-recovery';
import { jsonDocumentCapabilities, type JsonDocumentMeta } from './json-document-capabilities';
import {
  configDocumentKey,
  jsonDocumentId,
  jsonRecoveryValue,
  type ConfigDocumentTarget,
  type JsonDocumentDefinition,
  type JsonDocumentRecord,
} from '@/domain/json-editor/json-document-definitions';
import { useJsonEditorStore } from '@/stores/json-editor.store';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useSaveCommandStore, type SaveSessionHandle } from '@/stores/save-command.store';
import { useSettingsStore } from '@/stores/settings.store';
import { subscribeQueryInvalidations } from '@/services/query-cache.service';
import { hasEntityInvalidation } from '@/services/entity-query.service';
import { completeJsonSave } from '@/orchestrators/json-save.orchestrator';
import { relativePathFromRoot } from '@/shared/lib/paths';
import type { DocumentEditorActions, DocumentSaveResult } from '@/shared/runtime/document-editor';
import type { AppFeedback, RowData } from '@/shared/types';

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
  const capabilities = jsonDocumentCapabilities(definition, feedback, record.target.id);
  const active = ref(false);
  const reads = useQueryReadOwner();
  const modRoot = computed(() => record.target.modRoot);
  const session = useEditTargetDraftSession<RowData, ConfigDocumentTarget, JsonDocumentMeta>({
    emptyValue: {},
    targetKey: configDocumentKey,
    load: capabilities.load,
    save: capabilities.save,
    acceptSaved: (snapshot) => {
      if (snapshot.meta.recovery) {
        recovery.accept(snapshot.meta.recovery);
      }
    },
    synchronizeSaved: async (snapshot) => {
      await completeJsonSave(
        snapshot.target.modRoot,
        snapshot.target.sessionId,
        snapshot.meta.receipt!,
        snapshot.meta.recovery ? '重新创建 JSON 来源' : '保存' + definition.label + ' ' + snapshot.target.id,
      );
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
          read: (target, id, signal) => capabilities.load({ ...target, id }, signal),
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
    const committed = session.inputs.commit(undefined, true);
    if (committed && !(await committed)) return { status: 'cancelled' };
    if (!write && !session.dirty.value && !session.hasPendingSynchronization.value) return { status: 'noop' };
    const snapshot = await session.saveDraft(write, Boolean(write));
    return snapshot ? { status: 'saved', receipt: snapshot.meta.receipt! } : { status: 'cancelled' };
  }
  const handle: SaveSessionHandle = {
    targetKey: session.currentTargetKey,
    modRoot,
    saving: session.saving,
    pendingSynchronization: session.hasPendingSynchronization,
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
    pendingSynchronization: session.hasPendingSynchronization,
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
    subscribeQueryInvalidations((event) => {
      if (event.sessionId !== record.target.sessionId || event.scope === 'session') return;
      if (
        definition.kind !== 'mod-info' &&
        !(definition.kind === 'misc-config'
          ? hasMiscConfigInvalidation(event, record.target.modRoot, miscConfigFile(record.target.id).kind)
          : hasEntityInvalidation(event, 'entity-detail', definition.kind, session.currentTarget.value!.id))
      )
        return;
      if (active.value)
        reads.schedule('refresh', () => {
          void refresh().catch((error) => feedback.error(error, '刷新 JSON 文档失败'));
        });
    }),
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
    schema: capabilities.schema,
    draftValue: computed({ get: () => session.draftValue.value, set: setDraft }),
    sourceTarget: computed(() => identity.pending.value?.snapshot.target ?? session.currentTarget.value!),
    sourceMissing: recovery.missing,
    recreateSources: recovery.recreate,
    handoffLocked: computed(() => commands.isEditTargetLocked(session.currentTargetKey.value)),
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
