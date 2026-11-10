import { computed, ref, shallowRef, watch } from 'vue';
import { createJsonDocument, projectJsonValue, type JsonDocument } from '@/domain/json-document';
import { prepareValue } from '@/domain/schema/game-number';
import { prepareSchemaAtPath } from '@/domain/schema/schema-values';
import { getSchema } from '@/domain/schema/config-schema-registry';
import { composeJson, editComposedJson, takeReplaceBase, setCompositionValue } from '@/domain/json-composition';
import { captureJsonEdits } from '@/shared/lib/json-edits';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { captureIdentityVersions } from '@/domain/project/entity-versions';
import { createFieldInputs } from '@/shared/runtime/field-inputs';
import { pickEditorSpecFile } from '@/shared/runtime/dialog.runtime';
import { createSpecProblems } from './use-spec-problems';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useSettingsStore } from '@/stores/settings.store';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { useSaveCommandStore, type SaveParticipant } from '@/stores/save-command.store';
import { loadSpecEditorImport, saveSpecEditorSpec } from '@/services/spec-editor.service';
import { querySourceOptionCatalog } from '@/services/source-catalog.service';
import { releaseNativeWindowTargets } from '@/services/window.service';
import { reserveEntityIntent, retargetEntityWindow } from '@/orchestrators/spec-editor-identity.orchestrator';
import {
  beginSavedWrite,
  listenSavedContent,
  listenSavedIdentity,
  sessionContentUpdate,
  refreshProjectSourcePaths,
} from '@/orchestrators/project-sync.orchestrator';
import { closeCurrentWindow } from '@/windows/current.window';
import { normalizeFsPath } from '@/shared/lib/paths';
import { AppError, formatError } from '@/shared/lib/errors';
import { requireRowData } from '@/shared/lib/row-data';
import { dialogBody, dialogFiles, dialogSelect } from '@/shared/ui/dialog-content';
import type { FieldEditorContext } from '@/domain/field-editor/field-editor-context';
import type { SpecEditorDefinition, SpecEditorTarget } from './spec-editor.types';
import type {
  EditContext,
  SpecEditorData,
  SpecEditorKind,
  RowData,
  InvalidatedResourceScope,
  CommittedWriteEvent,
  WriteResult,
} from '@/shared/types';
import type { JsonFileContent, DocumentEdit } from '@/shared/types';

export function useSpecEditorWindowViewModel(
  params: { sessionId: string | null; modRoot: string | null; id: string | null; kind: SpecEditorKind },
  definition: SpecEditorDefinition<SpecEditorData>,
) {
  const reads = useQueryReadOwner(),
    settings = useSettingsStore(),
    commands = useSaveCommandStore();
  const feedback = useAppFeedback(() => ({ paths: baseline.value?.baseVersions.map((version) => version.path) ?? [] }));
  const baseline = shallowRef<SpecEditorData | null>(null),
    pending = shallowRef<SpecEditorData | null>(null),
    document = shallowRef<JsonDocument | null>(null);
  const revision = ref(0),
    saving = ref(false),
    loading = ref(false),
    errorText = ref('');
  const currentTarget = computed<SpecEditorTarget | null>(() =>
    params.sessionId && params.modRoot && params.id
      ? { sessionId: params.sessionId, modRoot: params.modRoot, kind: params.kind, id: baseline.value?.target.id ?? params.id }
      : null,
  );
  const targetKey = computed(() => (currentTarget.value ? JSON.stringify(currentTarget.value) : null));
  const inputs = createFieldInputs(targetKey),
    editContext = shallowRef<EditContext | null>(null);
  let disposed = false,
    submittedId: string | undefined,
    acceptedId: string | undefined,
    pendingSave: Promise<WriteResult<JsonFileContent> | null> | null = null;
  let stopContent: (() => void) | null = null,
    stopIdentity: (() => void) | null = null,
    setup: Promise<void> | null = null;
  let closePrepared = false,
    refreshQueued = false;
  const projection = computed(() => {
    void revision.value;
    return document.value ? requireRowData(document.value.projection, '规格内容无效') : {};
  });
  const partial = computed(() => Boolean(baseline.value?.composition && !String(projection.value[definition.idField] ?? '').trim()));
  const editorData = computed(() =>
    baseline.value ? { ...baseline.value, spec: composeJson(projection.value, baseline.value.composition) } : null,
  );
  const draftDirty = computed(() => {
    void revision.value;
    return Boolean(document.value?.dirty || baseline.value?.isNew || inputs.dirty.value);
  });
  const problems = createSpecProblems(
    inputs,
    () => definition.validate?.(partial.value ? projection.value : (editorData.value?.spec ?? {}), partial.value) ?? [],
  );
  watch([revision, editContext], problems.clearFailure);
  function publish(data: SpecEditorData, handoff: EditContext['handoff']) {
    baseline.value = data;
    editContext.value = { targetKey: targetKey.value!, baselineGeneration: (editContext.value?.baselineGeneration ?? 0) + 1, handoff };
    revision.value++;
  }
  function load(data: SpecEditorData) {
    inputs.cancel();
    document.value = createJsonDocument(data.document, { value: prepareValue(data.spec).value, historyLimit: settings.editHistoryLimit });
    publish(data, 'load');
    pending.value = null;
  }
  function updateLocal(value: RowData) {
    reads.revoke();
    const schema = getSchema('spec-' + params.kind)!;
    document.value!.update(value, (value, path) => prepareSchemaAtPath(value, path, schema));
    revision.value++;
  }
  function updateEditorDraft(value: RowData) {
    if (!editorData.value) return;
    const normalize = (value: RowData) => definition.normalize?.(value) ?? value;
    const before = normalize(editorData.value.spec);
    if (baseline.value!.composition) {
      const edit = editComposedJson(projection.value, before, value, baseline.value!.composition, [], normalize);
      if (edit.notice) feedback.info(edit.notice);
      if (!edit.rejected) updateLocal(edit.value);
    } else {
      let next = projection.value;
      for (const edit of captureJsonEdits(before, value))
        next = setCompositionValue(next, edit.path, edit.kind === 'set' ? edit.value : undefined);
      updateLocal(next);
    }
  }
  const draftValue = computed({ get: () => projection.value, set: updateEditorDraft });
  const sourceNotices = shallowRef<Record<string, string>>({});
  const releaseSourceProblems = problems.register(() =>
    Object.entries(sourceNotices.value).map(([path, message]) => ({ severity: 'warning', code: 'spec.source_read', path, message })),
  );
  const schemaRuntimeContext = computed<FieldEditorContext | null>(() => {
    void revision.value;
    const target = currentTarget.value;
    if (!target || !document.value) return null;
    return {
      sessionId: target.sessionId,
      modRoot: target.modRoot,
      document: document.value,
      partial: partial.value,
      applyDocumentEdit(edit: DocumentEdit) {
        document.value!.apply(edit);
        revision.value++;
      },
      sourceContextKey: targetKey.value!,
      querySourceOptions: async (source, signal) => {
        const generation = editContext.value;
        try {
          const value = await querySourceOptionCatalog(target.sessionId, source, signal);
          if (generation === editContext.value) delete sourceNotices.value[source];
          return value;
        } catch (error) {
          if (!signal?.aborted && generation === editContext.value)
            sourceNotices.value = { ...sourceNotices.value, [source]: formatError(error) };
          throw error;
        }
      },
    };
  });
  async function refresh(prompt = false) {
    if (saving.value || closePrepared) {
      refreshQueued = true;
      return;
    }
    const target = currentTarget.value;
    if (!target) return;
    loading.value = true;
    errorText.value = '';
    try {
      let initial: SpecEditorData | null = null;
      const accepted = await reads.consume('spec', target, (signal) => definition.read(target.sessionId, target.id, signal), {
        ready: (data) => {
          if (!prompt && draftDirty.value) {
            if (stableDeepEqual(data.spec, baseline.value!.spec)) {
              if (data.document)
                document.value!.accept(
                  { ...document.value!.capture('preserveStructure'), root: document.value!.state.baseline },
                  data.document,
                );
              publish(data, 'external');
              return;
            }
            pending.value = data;
            return;
          }
          load(data);
          if (prompt && data.isNew) initial = data;
        },
      });
      if (accepted && initial) await chooseInitial(initial);
    } catch (error) {
      errorText.value = formatError(error);
      throw error;
    } finally {
      loading.value = false;
    }
  }
  async function chooseInitial(data: SpecEditorData) {
    const source = ref('create');
    const choice = await feedback.choose({
      title: '找不到规格文件',
      content: () =>
        dialogBody(
          dialogFiles([data.target.write.path]),
          dialogSelect('内容来源', source, [
            { label: '使用默认内容', value: 'create' },
            { label: '导入已有规格', value: 'import' },
          ]),
        ),
      choices: [{ label: '继续编辑', value: 'continue', type: 'primary' }],
      cancelText: '返回',
    });
    if (disposed) return;
    if (!choice) {
      await closeCurrentWindow();
      return;
    }
    if (source.value === 'import') {
      const path = await pickEditorSpecFile();
      if (!path) return;
      const imported = await loadSpecEditorImport(params.kind, path);
      const value = requireRowData(projectJsonValue(imported.content), '导入规格内容无效');
      document.value = createJsonDocument(imported, { historyLimit: settings.editHistoryLimit });
      publish({ ...data, document: imported, spec: value }, 'load');
    }
  }
  function waitForSave() {
    return pendingSave
      ? pendingSave.then(
          (value) => Boolean(value),
          () => false,
        )
      : Promise.resolve(true);
  }
  function save(): Promise<WriteResult<JsonFileContent> | null> {
    if (pendingSave) return pendingSave;
    if (!baseline.value || useProjectSyncStore().isWaiting(params.modRoot)) return Promise.resolve(null);
    saving.value = true;
    problems.clearFailure();
    reads.revoke();
    const work = (async () => {
      const committed = inputs.commit(undefined, true);
      if (committed && !(await committed)) return null;
      const issues = [...problems.issues.value];
      if (issues.some((issue) => issue.severity === 'error')) throw new AppError('规格内容无效', { action: 'spec-validation' });
      const before = baseline.value!,
        owner = document.value!,
        target = currentTarget.value!,
        submitted = projection.value;
      const replaced = takeReplaceBase(submitted);
      const captured = owner.capture(settings.preserveStructure ? 'preserveStructure' : 'expanded');
      const warnings = issues.filter((issue) => issue.severity === 'warning');
      if (warnings.length && !settings.ignoreEditorWarnings) {
        const choice = await feedback.choose({
          title: '仍要保存吗？',
          content: () => dialogBody(dialogFiles([baseline.value!.target.write.path]), ...warnings.map((issue) => issue.message)),
          choices: [{ label: '仍然保存', value: 'save', type: 'warning' }],
          cancelText: '返回编辑',
        });
        if (choice !== 'save') return null;
      }
      const reserved = await reserveEntityIntent(
        target.sessionId,
        target.modRoot,
        before.target,
        replaced.value,
        feedback,
        before.spec,
        before.composition,
      );
      if (!reserved || disposed) return null;
      const task = beginSavedWrite(
        (request) =>
          saveSpecEditorSpec(
            {
              sessionId: target.sessionId,
              modRoot: target.modRoot,
              target: before.target,
              baseVersions: reserved.intent
                ? captureIdentityVersions(before.baseVersions, reserved.intent.destinationVersion)
                : before.baseVersions,
              document: captured.request,
              jsonWrite: {
                keepFilename: reserved.keepFilename,
                preserveStructure: captured.request.layout === 'preserveStructure',
                replacePaths: replaced.replace ? [before.target.write.relPath] : [],
              },
            },
            captured.edits,
            request,
          ),
        (result) => [
          () => {
            if (disposed || owner !== document.value) return;
            const actual = result.content!.value;
            owner.accept(captured, actual);
            const savedTarget = result.identityChanges[0]?.after ?? before.target;
            const data = {
              ...before,
              target: savedTarget,
              document: actual,
              spec: requireRowData(projectJsonValue(actual.content), '规格内容无效'),
              baseVersions: result.baseVersions,
              isNew: false,
              composition: replaced.replace && before.composition ? { ...before.composition, replace: true } : before.composition,
            };
            acceptedId = result.requestId;
            publish(data, 'save');
          },
          async () => {
            const next = baseline.value!.target;
            await retargetEntityWindow(target.sessionId, target.modRoot, target.kind, next.id);
            await releaseNativeWindowTargets();
          },
        ],
      );
      submittedId = task.id;
      return await task.result;
    })()
      .catch((error) => {
        throw problems.mapSaveError(error);
      })
      .finally(() => {
        saving.value = false;
        pendingSave = null;
        if (refreshQueued && !disposed) {
          refreshQueued = false;
          void refresh().catch((error) => feedback.error(error, '刷新规格失败'));
        }
      });
    pendingSave = work;
    return work;
  }
  async function saveEditorData(value?: RowData) {
    if (value) updateEditorDraft(value);
    try {
      const result = await save();
      if (result) feedback.success('规格已保存', { paths: result.baseVersions.map((version) => version.path) });
    } catch (error) {
      feedback.error(error);
    }
  }
  const participant: SaveParticipant = {
    targetKey,
    modRoot: computed(() => params.modRoot),
    saving,
    waitForSave,
    editing: {
      label: '专项编辑器',
      dirty: draftDirty,
      draftSession: {
        draftValue,
        inputs,
        prepareClose: () => {
          closePrepared = true;
          reads.revoke();
          return async () => {
            closePrepared = false;
            if (refreshQueued) {
              refreshQueued = false;
              await refresh();
            }
          };
        },
      },
      targets: computed(
        () =>
          baseline.value?.baseVersions.map((version) => ({ sessionId: params.sessionId!, modRoot: params.modRoot!, path: version.path })) ??
          [],
      ),
      save: async () => {
        const result = await save();
        return result ? { status: 'saved', receipt: result } : { status: 'cancelled' };
      },
    },
  };
  const unregister = commands.registerSaveParticipant(participant),
    { confirmDiscard } = useFieldInputActions(inputs, feedback);
  async function handleIdentity(event: CommittedWriteEvent) {
    const target = currentTarget.value;
    if (!target || (submittedId && event.result.requestId === submittedId) || !sessionContentUpdate(event, target.sessionId)) return;
    const change = event.result.identityChanges.find((change) => change.before.kind === target.kind && change.before.id === target.id);
    if (
      !change ||
      (change.before.id === change.after.id && normalizeFsPath(change.before.write.path) === normalizeFsPath(change.after.write.path))
    )
      return;
    if (
      draftDirty.value &&
      (await feedback.choose({
        title: '跟随规格改名？',
        content: '保留当前编辑并采用新文件：\n' + change.after.write.path,
        choices: [{ label: '保留编辑并跟随', value: 'follow', type: 'primary' }],
        cancelText: '稍后处理',
      })) !== 'follow'
    )
      throw new AppError('规格改名尚未确认', { code: 'write.identity_pending' });
    const next = await definition.read(target.sessionId, change.after.id);
    if (disposed) return;
    const owner = document.value!;
    if (next.document) owner.accept({ ...owner.capture('preserveStructure'), root: owner.state.baseline }, next.document);
    const value = { ...projection.value, [definition.idField]: next.target.id };
    updateLocal(value);
    await retargetEntityWindow(target.sessionId, target.modRoot, target.kind, next.target.id);
    publish(next, 'identity');
  }
  async function initializeEditorWindow() {
    await (setup ??= (async () => {
      stopIdentity = await listenSavedIdentity(handleIdentity);
      stopContent = await listenSavedContent((event) => {
        if (
          disposed ||
          (submittedId && event.result.requestId === submittedId) ||
          (acceptedId && event.result.requestId === acceptedId) ||
          !currentTarget.value
        )
          return;
        const target = currentTarget.value;
        if (!sessionContentUpdate(event, target.sessionId)) return;
        const content = event.result.content;
        if (content?.target.kind === 'spec' && content.target.target.kind === target.kind && content.target.target.id === target.id) {
          const actual = content.value as JsonFileContent;
          const next = {
            ...baseline.value!,
            document: actual,
            spec: requireRowData(projectJsonValue(actual.content), '规格内容无效'),
            target: content.target.target,
            baseVersions: event.result.baseVersions,
            isNew: false,
          };
          if (draftDirty.value) pending.value = next;
          else load(next);
          return;
        }
        return refresh();
      });
      if (disposed) {
        stopIdentity();
        stopContent();
        return;
      }
      await refresh(true);
    })());
  }
  function disposeEditorWindow() {
    disposed = true;
    reads.revoke();
    stopIdentity?.();
    stopContent?.();
    unregister();
    releaseSourceProblems();
    inputs.release();
  }
  return {
    problems,
    inputs,
    currentTarget,
    schemaRuntimeContext,
    editorData,
    loading,
    errorText,
    draftValue,
    editContext,
    contentReady: computed(() => baseline.value !== null),
    previewValue: computed(() => editorData.value?.spec ?? {}),
    draftDirty,
    saving,
    draftSaving: saving,
    handoffLocked: computed(() => false),
    canSaveSpec: computed(() => baseline.value !== null && !useProjectSyncStore().isWaiting(params.modRoot)),
    externalUpdateNotice: computed(() => (pending.value ? '外部版本已更新，当前未保存草稿已保留。' : '')),
    missingEditorText: computed(() => `找不到 ${currentTarget.value?.id ?? ''} 的规格文件。`),
    waitForSave,
    initializeEditorWindow,
    disposeEditorWindow,
    saveEditorData,
    updateEditorDraft,
    commitInputs: () => inputs.commit(),
    resetDraft() {
      document.value!.state.resetDraft();
      inputs.cancel();
      revision.value++;
    },
    loadPendingExternalSpec() {
      confirmDiscard(
        () => {
          if (pending.value) load(pending.value);
        },
        draftDirty.value,
        () => targetKey.value,
        baseline.value!.baseVersions.map((version) => version.path),
      );
    },
    refresh: (resources: readonly InvalidatedResourceScope[], paths: string[] = []) =>
      refreshProjectSourcePaths(
        params.sessionId!,
        params.modRoot!,
        [...baseline.value!.baseVersions.map((version) => version.path), ...paths],
        resources,
      ),
  };
}
