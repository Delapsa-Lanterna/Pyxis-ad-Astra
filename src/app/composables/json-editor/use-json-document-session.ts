import { computed, effectScope, onScopeDispose, ref, shallowRef, watch } from 'vue';
import { createJsonDocument } from '@/domain/json-document';
import { prepareValue } from '@/domain/schema/game-number';
import { prepareSchemaAtPath } from '@/domain/schema/schema-values';
import { transferVariantWeaponSlots } from '@/domain/json-editor/json-variant-weapons';
import {
  configDocumentKey,
  jsonDocumentId,
  jsonDocumentIssues,
  jsonRecoveryValue,
  type ConfigDocumentTarget,
  type JsonDocumentDefinition,
  type JsonDocumentRecord,
} from '@/domain/json-editor/json-document-definitions';
import { miscConfigDefinition } from '@/domain/misc-config';
import { createFieldInputs } from '@/shared/runtime/field-inputs';
import { createEditorProblems } from '@/shared/runtime/editor-problems';
import { requireRowData } from '@/shared/lib/row-data';
import { relativePathFromRoot } from '@/shared/lib/paths';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { AppError } from '@/shared/lib/errors';
import { beginSavedWrite, observeSavedContent, sessionContentUpdate } from '@/orchestrators/project-sync.orchestrator';
import { releaseNativeWindowTargets } from '@/services/window.service';
import { useCoreSchema } from '@/app/composables/use-core-schema';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useJsonDocumentIdentity } from './use-json-document-identity';
import { useJsonSourceRecovery } from './use-json-source-recovery';
import { loadJsonDocument, saveJsonDocument, type JsonDocumentSnapshot, type JsonDocumentWriter } from './json-document-capabilities';
import { useJsonEditorStore } from '@/stores/json-editor.store';
import { useSettingsStore } from '@/stores/settings.store';
import { useSaveCommandStore, type SaveParticipant } from '@/stores/save-command.store';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import type { DocumentEditorActions, DocumentSaveResult } from '@/shared/runtime/document-editor';
import type { AppFeedback, EditContext, RowData } from '@/shared/types';
import type { DocumentEdit } from '@/shared/types';

export function useJsonDocumentSession(definition: JsonDocumentDefinition, record: JsonDocumentRecord, feedback: AppFeedback) {
  const editors = useJsonEditorStore(),
    { target } = record;
  return editors.retainDocument(configDocumentKey(target), target.sessionId, target.modRoot, () => {
    const scope = effectScope(true);
    const session = scope.run(() => createSession(definition, record, feedback))!;
    let key = configDocumentKey(target);
    scope.run(() =>
      watch(
        session.targetKey,
        (next) => {
          if (next && key !== next) {
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

function createSession(definition: JsonDocumentDefinition, record: JsonDocumentRecord, feedback: AppFeedback) {
  const editors = useJsonEditorStore(),
    settings = useSettingsStore(),
    commands = useSaveCommandStore();
  const { getMergedSchema } = useCoreSchema(),
    reads = useQueryReadOwner();
  const schema = computed(() =>
    getMergedSchema(definition.kind === 'misc-config' ? miscConfigDefinition(record.target.id).schema : definition.kind)!,
  );
  const filePath = definition.kind === 'mission' ? ['descriptor'] : ['variant', 'skin'].includes(definition.kind) ? [] : ['file'];
  const document = createJsonDocument(record.document!, {
    value: prepareValue(record.value).value,
    filePath,
    historyLimit: settings.editHistoryLimit,
  });
  const revision = ref(0),
    active = ref(false),
    saving = ref(false),
    sourceMissing = ref(false);
  const currentTarget = shallowRef<ConfigDocumentTarget | null>(record.target);
  const currentTargetKey = computed(() => (currentTarget.value ? configDocumentKey(currentTarget.value) : null));
  const inputs = createFieldInputs(currentTargetKey);
  const baselineSnapshot = shallowRef<JsonDocumentSnapshot>({
    target: record.target,
    value: record.value,
    baseVersions: record.baseVersions,
    meta: { document: record.document!, resources: record.resources, composition: record.composition, receipt: null },
  });
  const pendingSnapshot = shallowRef<JsonDocumentSnapshot | null>(null);
  const context = shallowRef<EditContext>({ targetKey: currentTargetKey.value!, baselineGeneration: 1, handoff: 'load' });
  const composition = computed(() => baselineSnapshot.value.meta.composition);
  let disposed = false,
    submittedRequestId: string | undefined,
    pendingSave: Promise<JsonDocumentSnapshot | null> | null = null;
  let prepared = false,
    refreshQueued = false;
  const touch = () => {
    revision.value++;
  };
  const projection = computed(() => {
    void revision.value;
    return requireRowData(document.projection, 'JSON 文档根对象无效');
  });
  const dirty = computed(() => {
    void revision.value;
    return document.dirty || inputs.dirty.value;
  });
  function setDraft(value: RowData) {
    reads.revoke();
    recovery.cancelRead();
    if (definition.kind === 'variant' && settings.editMode === 'smart') value = transferVariantWeaponSlots(projection.value, value);
    document.update(value, (value, path) => prepareSchemaAtPath(value, path, schema.value));
    touch();
  }
  const draftValue = computed({ get: () => projection.value, set: setDraft });
  function publish(snapshot: JsonDocumentSnapshot, handoff: EditContext['handoff']) {
    baselineSnapshot.value = snapshot;
    currentTarget.value = snapshot.target;
    context.value = { targetKey: configDocumentKey(snapshot.target), baselineGeneration: context.value.baselineGeneration + 1, handoff };
    pendingSnapshot.value = null;
    touch();
  }
  function loadBaseForTarget(snapshot: JsonDocumentSnapshot) {
    reads.revoke();
    inputs.cancel();
    document.reload(snapshot.meta.document, prepareValue(snapshot.value).value);
    publish(snapshot, 'load');
  }
  function acceptsSaveDelivery(target: ConfigDocumentTarget, id?: string) {
    return (
      !disposed &&
      configDocumentKey(target) === currentTargetKey.value &&
      !(id && (id === submittedRequestId || id === baselineSnapshot.value.requestId))
    );
  }
  function applyExternalForTarget(snapshot: JsonDocumentSnapshot) {
    if (disposed || configDocumentKey(snapshot.target) !== currentTargetKey.value) return 'obsolete' as const;
    if (saving.value || prepared) {
      refreshQueued = true;
      return 'obsolete' as const;
    }
    if (stableDeepEqual(snapshot.baseVersions, baselineSnapshot.value.baseVersions)) return 'baseline' as const;
    if (dirty.value) {
      pendingSnapshot.value = snapshot;
      return 'pending' as const;
    }
    loadBaseForTarget(snapshot);
    return 'baseline' as const;
  }
  function adoptIdentity(expected: ConfigDocumentTarget, snapshot: JsonDocumentSnapshot, map: (value: RowData) => RowData) {
    if (disposed || configDocumentKey(expected) !== currentTargetKey.value) return false;
    const mapped = map(projection.value);
    const captured = { ...document.capture('preserveStructure'), root: document.state.baseline };
    document.accept(captured, snapshot.meta.document, prepareValue(snapshot.value).value);
    document.update(mapped, (value, path) => prepareSchemaAtPath(value, path, schema.value));
    publish(snapshot, 'identity');
    return true;
  }
  async function refresh() {
    if (saving.value || prepared) {
      refreshQueued = true;
      return;
    }
    const target = currentTarget.value!;
    const plan = await recovery.refresh();
    if (!plan) return;
    sourceMissing.value = plan.missingPaths.length > 0;
    if (sourceMissing.value) return;
    const baseline = baselineSnapshot.value;
    const document = plan.documents[target.kind === 'mission' ? 'descriptor' : 'file']!;
    applyExternalForTarget({
      target,
      value: jsonRecoveryValue(target, plan, baseline.value),
      baseVersions: plan.baseVersions,
      meta: { ...baseline.meta, document, resources: plan.resourceRefs, receipt: null },
    });
  }
  const session = {
    currentTarget,
    currentTargetKey,
    baselineSnapshot,
    draftValue,
    context,
    inputs,
    dirty,
    saving,
    applyExternalForTarget,
    adoptIdentity,
    loadBaseForTarget,
    setDraft,
    acceptsSaveDelivery,
  };
  const identity = useJsonDocumentIdentity(
    session,
    active,
    definition.kind === 'mod-info' || definition.kind === 'misc-config'
      ? undefined
      : {
          kind: definition.kind,
          label: definition.label,
          read: (target, id, signal) => loadJsonDocument({ ...target, id }, signal),
          map: (value, previous, next) => {
            if (jsonDocumentId(definition, value) !== previous) return value;
            const path =
              definition.kind === 'mission'
                ? ['list', definition.idField]
                : definition.kind === 'faction'
                  ? ['file', definition.idField]
                  : [definition.idField];
            const root = structuredClone(value);
            let parent = root;
            for (const key of path.slice(0, -1)) parent = parent[key] as RowData;
            parent[path.at(-1)!] = next;
            return root;
          },
        },
    feedback,
  );
  const problems = createEditorProblems(
    inputs,
    () => jsonDocumentIssues(definition, schema.value, projection.value, composition.value),
    true,
  );
  watch([revision, composition], problems.clearFailure);
  const write: JsonDocumentWriter = (target, draft, versions, original, captured, request) =>
    saveJsonDocument(definition, schema.value, feedback, target, draft, versions, original, captured, request, composition.value);
  function saveDraft(writer: JsonDocumentWriter = write, preserveDraft = false): Promise<JsonDocumentSnapshot | null> {
    if (pendingSave) return pendingSave;
    saving.value = true;
    reads.revoke();
    const operation = (async () => {
      const committed = inputs.commit(undefined, true);
      if (committed && !(await committed)) return null;
      if (!preserveDraft && problems.issues.value.some((issue) => issue.severity === 'error'))
        throw new AppError('请先解决文档中的字段错误', { action: 'json-validation' });
      const baseline = baselineSnapshot.value,
        target = currentTarget.value!,
        captured = document.capture(settings.preserveStructure ? 'preserveStructure' : 'expanded');
      const submitted = projection.value;
      const task = beginSavedWrite(
        (request) => writer(target, submitted, baseline.baseVersions, baseline.value, captured, request),
        (snapshot) => [
          () => {
            if (disposed) return;
            document.accept(
              preserveDraft ? { ...captured, root: document.state.baseline } : captured,
              snapshot.meta.document,
              prepareValue(snapshot.value).value,
            );
            publish(snapshot, 'save');
            sourceMissing.value = false;
          },
          () => releaseNativeWindowTargets(),
          async () => {
            if (refreshQueued) {
              refreshQueued = false;
              await refreshAfterSave();
            }
          },
        ],
      );
      submittedRequestId = task.id;
      const snapshot = await task.result;
      if (snapshot) feedback.success('当前 JSON 文档已保存', { paths: snapshot.baseVersions.map((version) => version.path) });
      return snapshot ?? null;
    })()
      .catch((error) => {
        if (!(error instanceof AppError && ['json-validation', 'commit-field-inputs'].includes(error.action ?? '')))
          problems.recordFailure(error);
        throw error;
      })
      .finally(() => {
        saving.value = false;
        pendingSave = null;
      });
    pendingSave = operation;
    return operation;
  }
  async function refreshAfterSave() {
    const snapshot = await loadJsonDocument(currentTarget.value!);
    if (!disposed && configDocumentKey(snapshot.target) === currentTargetKey.value) {
      if (dirty.value) pendingSnapshot.value = snapshot;
      else loadBaseForTarget(snapshot);
    }
  }
  async function saveActual(writer?: JsonDocumentWriter): Promise<DocumentSaveResult> {
    if (!writer && !dirty.value) return { status: 'noop' };
    const snapshot = await saveDraft(writer, Boolean(writer));
    return snapshot ? { status: 'saved', receipt: snapshot.meta.receipt! } : { status: 'cancelled' };
  }
  const waitForSave = () =>
    pendingSave
      ? pendingSave.then(
          (value) => value !== null,
          () => false,
        )
      : Promise.resolve(true);
  function prepareClose() {
    prepared = true;
    reads.revoke();
    return async () => {
      prepared = false;
      if (refreshQueued) {
        refreshQueued = false;
        await refresh();
      }
    };
  }
  const participant: SaveParticipant = {
    targetKey: currentTargetKey,
    modRoot: computed(() => record.target.modRoot),
    saving,
    waitForSave,
    editing: {
      label: definition.label,
      dirty,
      draftSession: { draftValue, inputs, prepareClose },
      save: () => saveActual(),
      targets: computed(() =>
        baselineSnapshot.value.baseVersions.map((version) => ({
          sessionId: record.target.sessionId,
          modRoot: record.target.modRoot,
          path: version.path,
        })),
      ),
    },
  };
  const save = (writer?: JsonDocumentWriter) => commands.requestSave(participant, () => saveActual(writer));
  const recovery = useJsonSourceRecovery({ session, active, save, feedback });
  const { confirmDiscard } = useFieldInputActions(inputs, feedback);
  async function replay(direction: 'undo' | 'redo') {
    const committed = inputs.commit();
    if (committed && !(await committed)) return false;
    const stack = direction === 'undo' ? document.history.undoStack : document.history.redoStack;
    if (!stack.length) return null;
    inputs.cancel();
    reads.revoke();
    document[direction]();
    touch();
    return true;
  }
  const actions: DocumentEditorActions<ConfigDocumentTarget> = {
    target: currentTarget,
    targetKey: currentTargetKey,
    inputs,
    dirty,
    saving: computed(() => saving.value || commands.isSaveQueued(participant)),
    canUndo: computed(() => {
      void revision.value;
      return document.history.undoStack.length > 0 || inputs.dirty.value;
    }),
    canRedo: computed(() => {
      void revision.value;
      return document.history.redoStack.length > 0 || inputs.dirty.value;
    }),
    undo: () => replay('undo'),
    redo: () => replay('redo'),
    save: () => save(),
    waitForSave: () => commands.waitForParticipant(participant),
  };
  function setActive(enabled: boolean, fresh = false) {
    if (enabled === active.value) return;
    active.value = enabled;
    if (enabled) {
      editors.activate(actions);
      if (!fresh) void refresh().catch((error) => feedback.error(error, '刷新 JSON 文档失败'));
    } else {
      editors.deactivate(actions);
      reads.revoke();
    }
  }
  watch(
    currentTarget,
    (next, before) => {
      if (next && before && next.id !== before.id) {
        const selected = editors.selection(next.sessionId, definition.kind);
        if (selected.value === before.id) selected.value = next.id;
      }
    },
    { flush: 'sync' },
  );
  onScopeDispose(useDraftSessionsStore().registerDraftSession(participant.modRoot, dirty));
  onScopeDispose(commands.registerSaveParticipant(participant));
  onScopeDispose(
    observeSavedContent((event) => {
      if (!acceptsSaveDelivery(currentTarget.value!, event.result.requestId)) return;
      if (sessionContentUpdate(event, currentTarget.value!.sessionId) && active.value) return refresh();
      return undefined;
    }),
  );
  onScopeDispose(() => {
    disposed = true;
    reads.revoke();
    editors.deactivate(actions);
    inputs.release();
  });
  return {
    ...actions,
    document,
    revision,
    active,
    setActive,
    schema,
    composition,
    problems,
    draftValue,
    applyEdit(edit: DocumentEdit) {
      reads.revoke();
      document.apply(edit);
      touch();
    },
    externalUpdateNotice: computed(() => (pendingSnapshot.value ? '外部版本已更新，当前未保存草稿已保留。' : '')),
    sourceMissing,
    sourceTarget: computed(() => identity.pending.value?.snapshot.target ?? currentTarget.value!),
    recreateSources: recovery.recreate,
    handoffLocked: computed(() => false),
    viewId: configDocumentKey(record.target),
    record: computed<JsonDocumentRecord>(() => ({
      target: currentTarget.value!,
      value: baselineSnapshot.value.value,
      document: baselineSnapshot.value.meta.document,
      baseVersions: baselineSnapshot.value.baseVersions,
      resources: baselineSnapshot.value.meta.resources ?? record.resources,
      composition: composition.value,
    })),
    paths: computed(() =>
      baselineSnapshot.value.baseVersions.map((version) => relativePathFromRoot(record.target.modRoot, version.path)).join(' · '),
    ),
    async loadPendingExternal() {
      if (await actions.waitForSave())
        confirmDiscard(
          () => {
            if (pendingSnapshot.value) loadBaseForTarget(pendingSnapshot.value);
          },
          dirty.value,
          () => currentTargetKey.value,
          baselineSnapshot.value.baseVersions.map((version) => version.path),
        );
    },
  };
}
export type JsonDocumentSession = ReturnType<typeof useJsonDocumentSession>;
