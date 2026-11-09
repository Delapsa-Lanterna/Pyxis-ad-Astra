import { useSettingsStore } from '@/stores/settings.store';
import { dialogBody, dialogFiles, dialogGroup, dialogSelect } from '@/shared/ui/dialog-content';
import { releaseNativeWindowTargets } from '@/services/window.service';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { beginSavedWrite } from '@/orchestrators/project-sync.orchestrator';
import type { FieldEditorContext } from '@/domain/field-editor/field-editor-context';
import { querySourceOptionCatalog } from '@/services/source-catalog.service';
import { hasEntityInvalidation } from '@/services/entity-query.service';
import {
  refreshProjectSourcePaths,
  listenSavedContent,
  sessionContentUpdate,
  listenSavedIdentity,
} from '@/orchestrators/project-sync.orchestrator';
import type { SpecEditorDefinition, SpecEditorTarget } from './spec-editor.types';
import { isReadInvalidated } from '@/shared/runtime/read-request';
import { computed, ref, shallowReactive, shallowRef, watch } from 'vue';
import { createSpecProblems } from './use-spec-problems';
import { loadSpecEditorImport, saveSpecEditorSpecByKind } from '@/services/spec-editor.service';
import type {
  SpecEditorKind,
  RowData,
  WriteResult,
  SpecEditorData,
  CommittedWriteEvent,
  InvalidatedResourceScope,
} from '@/shared/types/index';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { deepClone } from '@/shared/lib/starsector/index';
import { AppError, formatError } from '@/shared/lib/errors';
import { requireRowData } from '@/shared/lib/row-data';
import { normalizeFsPath } from '@/shared/lib/paths';
import { captureIdentityVersions } from '@/domain/project/entity-versions';

import { reserveEntityIntent, retargetEntityWindow } from '@/orchestrators/spec-editor-identity.orchestrator';
import { composeJson, editComposedJson, compositionPath, compositionValue, takeReplaceBase } from '@/domain/json-composition';

import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useEditTargetDraftSession, type EditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { pickEditorSpecFile } from '@/shared/runtime/dialog.runtime';
import { closeCurrentWindow } from '@/windows/current.window';

type MissingSpecChoice = { action: 'create' } | { action: 'import'; data: RowData } | { action: 'cancel' };

export function useSpecEditorWindowViewModel(
  params: {
    sessionId: string | null;
    modRoot: string | null;
    id: string | null;
    kind: SpecEditorKind;
  },
  definition: SpecEditorDefinition<SpecEditorData>,
) {
  const feedback = useAppFeedback();
  let missingSpecIntent: object | null = null;
  const draftSession: EditTargetDraftSession<RowData, SpecEditorTarget, { data: SpecEditorData; receipt: WriteResult<unknown> | null }> =
    useEditTargetDraftSession<RowData, SpecEditorTarget, { data: SpecEditorData; receipt: WriteResult<unknown> | null }>({
      emptyValue: {},
      beginSave: beginSavedWrite,
      savedContent: (snapshot) => ({ ...snapshot, meta: { ...snapshot.meta, receipt: null } }),
      load: async (target, signal) => {
        const data = await definition.read(target.sessionId, target.id, signal);
        return {
          target,
          meta: { data, receipt: null },
          baseVersions: data.baseVersions,
          value: deepClone(data.spec),
        };
      },
      confirmSave: async () => {
        problems.clearFailure();
        const context = draftSession.context.value;
        const issues = [...problems.issues.value];
        if (issues.some((issue) => issue.severity === 'error')) throw new AppError('规格内容无效', { action: 'spec-validation' });
        const warnings = issues.filter((issue) => issue.severity === 'warning');
        if (!warnings.length || useSettingsStore().ignoreEditorWarnings) return true;
        const choice = await feedback.choose({
          title: '仍要保存吗？',
          content: () =>
            dialogBody(
              '这份规格有 ' + warnings.length + ' 条保存提醒：',
              dialogFiles([editorData.value!.target.write.path]),
              ...warnings.map((issue) =>
                dialogGroup(
                  issue.path,
                  compositionValue(editorData.value!.spec, compositionPath(issue.path)) === undefined
                    ? '尚未填写此字段。'
                    : '当前填写：' + JSON.stringify(compositionValue(editorData.value!.spec, compositionPath(issue.path))),
                  issue.message,
                ),
              ),
            ),
          choices: [{ label: '仍然保存', value: 'save', type: 'warning' }],
          cancelText: '返回编辑',
        });
        return choice === 'save' && draftSession.context.value === context;
      },
      save: async (target, submitted, baseVersions, original, request) => {
        const submittedData = deepClone(editorData.value!);
        const replaced = takeReplaceBase(submitted);
        const draft = replaced.value;
        const reserved = await reserveEntityIntent(
          target.sessionId,
          target.modRoot,
          submittedData.target,
          draft,
          feedback,
          original,
          submittedData.composition,
        );
        if (!reserved) return;
        const { keepFilename, intent } = reserved;
        const versions = intent ? captureIdentityVersions(baseVersions, intent.destinationVersion) : baseVersions;
        const result = await runConfirmedJsonWrite(
          feedback,
          (options) =>
            saveSpecEditorSpecByKind(
              target.sessionId,
              target.modRoot,
              submittedData.target,
              draft,
              keepFilename ? { ...options, keepFilename } : options,
              versions,
              original,
              request,
            ),
          replaced.replace ? [submittedData.target.write.relPath] : [],
        );
        if (!result) return;
        const value = result.content!.value;
        const savedTarget = result.identityChanges[0]!.after;
        return {
          target: { ...target, id: savedTarget.id },
          value,
          baseVersions: result.baseVersions,
          requestId: result.requestId,
          meta: {
            data: {
              ...submittedData,
              spec: value,
              target: savedTarget,
              isNew: false,
              baseVersions: result.baseVersions,
              ...(replaced.replace && submittedData.composition ? { composition: { ...submittedData.composition, replace: true } } : {}),
            },
            receipt: result,
          },
        };
      },
      targetKey: editorWindowTargetKey,
      mapSaveError: (error) => problems.mapSaveError(error),
      afterSaved: () => problems.clearFailure(),

      acceptSaved: async (snapshot) => {
        await retargetEntityWindow(snapshot.target.sessionId, snapshot.target.modRoot, snapshot.target.kind, snapshot.target.id);
        await releaseNativeWindowTargets();
      },
    });
  const partial = computed(() =>
    Boolean(
      draftSession.baselineSnapshot.value?.meta.data.composition && !String(draftSession.draftValue.value[definition.idField] ?? '').trim(),
    ),
  );
  const problems = createSpecProblems(draftSession.inputs, () => {
    const sources = draftSession.baselineSnapshot.value?.meta.data.composition;
    const value = partial.value ? draftSession.draftValue.value : composeJson(draftSession.draftValue.value, sources);
    return definition.validate?.(value, partial.value) ?? [];
  });
  watch(draftSession.context, () => problems.clearFailure(), { flush: 'sync' });
  const unregisterSave = useSaveCommandStore().registerSaveParticipant({
    targetKey: draftSession.currentTargetKey,
    modRoot: computed(() => params.modRoot),
    saving: draftSession.saving,
    waitForSave: draftSession.waitForSave,
    editing: {
      targets: computed(() => {
        const snapshot = draftSession.baselineSnapshot.value;
        return snapshot
          ? snapshot.baseVersions.map((version) => ({
              sessionId: snapshot.target.sessionId,
              modRoot: snapshot.target.modRoot,
              path: version.path,
            }))
          : [];
      }),
      label: '专项编辑器',
      dirty: draftSession.dirty,
      draftSession: draftSession,
      save: async () => {
        const snapshot = await draftSession.saveDraft();
        return snapshot ? { status: 'saved', receipt: snapshot.meta.receipt! } : { status: 'cancelled' };
      },
    },
  });
  const loading = draftSession.loading;
  const { confirmDiscard } = useFieldInputActions(draftSession.inputs);
  const errorText = shallowRef('');
  let unlistenChanges: Awaited<ReturnType<typeof listenSavedContent>> | null = null;
  let unlistenIdentity: Awaited<ReturnType<typeof listenSavedIdentity>> | null = null;
  let disposed = false;
  const editorData = computed(() => {
    const data = draftSession.baselineSnapshot.value?.meta.data;
    return data ? { ...data, spec: composeJson(draftSession.draftValue.value, data.composition) } : null;
  });
  const draftDirty = draftSession.dirty;
  const currentTarget = computed(editorWindowTarget);
  const sourceNotices = shallowReactive(new Map<string, string>());
  const sourceIdentity = () => JSON.stringify([currentTarget.value, draftSession.context.value?.baselineGeneration]);
  watch(sourceIdentity, () => sourceNotices.clear());
  const schemaRuntimeContext = computed<FieldEditorContext | null>(() => {
    if (!currentTarget.value) return null;
    const identity = sourceIdentity(),
      runtime = { modRoot: currentTarget.value.modRoot, sessionId: currentTarget.value.sessionId };
    return {
      ...runtime,
      partial: partial.value,
      sourceContextKey: JSON.stringify([currentTarget.value.modRoot, currentTarget.value.kind, currentTarget.value.id]),
      querySourceOptions: async (source: string, signal?: AbortSignal) => {
        try {
          const result = await querySourceOptionCatalog(runtime.sessionId, source, signal);
          if (identity === sourceIdentity()) sourceNotices.delete(source);
          return result;
        } catch (error) {
          if (!signal?.aborted && identity === sourceIdentity()) sourceNotices.set(source, formatError(error));
          throw error;
        }
      },
    };
  });
  const releaseSourceProblems = problems.register(() =>
    [...sourceNotices.entries()].map(([path, message]) => ({ severity: 'warning' as const, code: 'spec.source_read', path, message })),
  );
  const editContext = draftSession.context;
  const draftSaving = draftSession.saving;
  const externalUpdateNotice = draftSession.externalUpdateNotice;
  const canSaveSpec = computed(() => draftSession.ready.value && !useProjectSyncStore().isWaiting(params.modRoot));

  const missingEditorText = computed(() => {
    const target = editorWindowTarget();
    if (!target) return '缺少 Mod 路径或目标 id。';
    return `找不到 ${target.id} 的 spec。`;
  });

  async function queryEditorData(options: { promptForMissing: boolean; showLoading: boolean }) {
    const intent = {};
    missingSpecIntent = intent;
    const target = editorWindowTarget();
    if (!target) {
      errorText.value = '缺少 Mod 路径或目标 id。';
      return;
    }
    errorText.value = '';
    try {
      const snapshot = options.promptForMissing ? await draftSession.loadTarget(target) : await draftSession.refreshTarget(target, true);
      if (!snapshot?.meta) return;
      const data = snapshot.meta.data;
      if (data.isNew && options.promptForMissing) {
        const choice = await handleMissingSpec(params.kind, target, data);
        if (missingSpecIntent !== intent) return;
        if (choice.action === 'cancel') {
          await closeCurrentWindow();
          return;
        }
        if (choice.action === 'import') applyImportedSpec(choice.data);
      }
    } catch (error) {
      if (isReadInvalidated(error)) return;
      if (options.showLoading) {
        errorText.value = formatError(error);
        throw error;
      } else {
        feedback.error(error, '刷新编辑器失败');
        throw error;
      }
    }
  }

  async function handleMissingSpec(kind: SpecEditorKind, target: SpecEditorTarget, data: SpecEditorData): Promise<MissingSpecChoice> {
    const source = ref('create');
    const choice = await feedback.choose({
      title: '找不到' + { ship: '舰船', weapon: '武器', projectile: '弹体', system: '战术系统' }[target.kind] + '规格',
      content: () =>
        dialogBody(
          `找不到${{ ship: '舰船', weapon: '武器', projectile: '弹体', system: '战术系统' }[target.kind]} ${target.id} 的规格文件：`,
          dialogFiles([data.target.write.path]),
          dialogSelect('内容来源', source, [
            { label: '使用默认内容', value: 'create' },
            { label: '导入已有规格', value: 'import' },
          ]),
          source.value === 'create'
            ? '使用默认内容建立草稿，随后可以继续编辑和保存。'
            : '下一步选择已有规格，将其内容导入当前草稿，随后可以继续编辑和保存。',
        ),
      choices: [
        {
          get label() {
            return source.value === 'create' ? '新建并编辑' : '选择文件并导入';
          },
          value: 'continue',
          type: 'primary',
        },
      ],
      cancelText: '返回',
    });
    if (!choice) return { action: 'cancel' };
    if (source.value === 'import') {
      const path = await pickEditorSpecFile();
      if (!path) return { action: 'cancel' };
      try {
        const data = await loadSpecEditorImport(kind, path);
        return { action: 'import', data };
      } catch (error) {
        feedback.error(error, '无法读取或解析所选文件');
        return { action: 'cancel' };
      }
    }
    return { action: 'create' };
  }

  function applyImportedSpec(data: RowData) {
    if (!editorData.value) return;
    draftSession.setDraft(data);
  }

  async function saveEditorData(data?: RowData): Promise<void> {
    const target = editorWindowTarget();
    if (!target) return;
    const sourcePath = editorData.value?.target.write.path;
    if (draftSession.saving.value) {
      await draftSession.waitForSave();
      return;
    }
    if (useProjectSyncStore().isWaiting(params.modRoot)) return;
    if (data) updateEditorDraft(data);
    try {
      const saved = await draftSession.saveDraft();
      if (saved) {
        feedback.success(`${target.id} 已保存`, sourcePath);
      }
    } catch (error) {
      feedback.error(error);
    }
  }

  function updateEditorDraft(data: RowData): void {
    const target = editorWindowTarget();
    if (!target || !editorData.value) return;
    const composition = editorData.value.composition;
    if (!composition) {
      draftSession.setDraft(data);
      return;
    }
    const normalize = (value: RowData) => definition.normalize?.(value) ?? value;
    const edit = editComposedJson(draftSession.draftValue.value, normalize(editorData.value.spec), data, composition, [], normalize);
    if (edit.notice) feedback.info(edit.notice);
    if (!edit.rejected) draftSession.setDraft(edit.value);
  }

  function loadPendingExternalSpec(): void {
    const target = editorWindowTarget();
    if (!target || !editorData.value || !draftSession.pendingExternalValue.value) return;
    if (draftSession.saving.value) {
      void draftSession.waitForSave().then((saved) => {
        if (saved && !disposed) loadPendingExternalSpec();
      });
      return;
    }
    confirmDiscard(
      draftSession.loadPendingExternal,
      draftSession.dirty.value,
      () => draftSession.currentTargetKey.value,
      editorData.value.baseVersions.map((version) => version.path),
    );
  }

  let setup: Promise<void> | null = null;
  async function initializeEditorWindow() {
    await (setup ??= setupEditorWindow());
    if (disposed) return;
    if (!draftSession.ready.value) await queryEditorData({ promptForMissing: true, showLoading: true });
    if (!draftSession.ready.value) throw new AppError('规格接纳已取消', { action: 'accept-window' });
  }
  async function setupEditorWindow() {
    if (disposed) return;
    unlistenIdentity = await listenSavedIdentity(handleIdentityApplied);
    if (disposed) {
      unlistenIdentity();
      unlistenIdentity = null;
      return;
    }
    unlistenChanges = await listenSavedContent(handleCommittedWriteEvent, (sessionId) => {
      if (sessionId === editorWindowTarget()?.sessionId) {
        missingSpecIntent = null;
        draftSession.cancelRead();
      }
    });
    if (disposed) unlistenChanges();
  }

  function disposeEditorWindow() {
    disposed = true;
    missingSpecIntent = null;
    unlistenIdentity?.();
    unlistenIdentity = null;
    unregisterSave();
    releaseSourceProblems();
    unlistenChanges?.();
    unlistenChanges = null;
    draftSession.dispose();
  }

  async function handleIdentityApplied(event: CommittedWriteEvent) {
    const target = editorWindowTarget();
    if (
      !target ||
      (event.sessionId !== target.sessionId && !sessionContentUpdate(event, target.sessionId)) ||
      normalizeFsPath(event.modRoot) !== normalizeFsPath(target.modRoot)
    )
      return;
    const change = event.result.identityChanges.find(
      (change) =>
        change.before.kind === target.kind &&
        change.before.id === target.id &&
        (change.after.id !== target.id || normalizeFsPath(change.before.write.path) !== normalizeFsPath(change.after.write.path)),
    );
    if (!change) return;
    if (disposed || !sameEditorWindowTarget(target, editorWindowTarget())) return;
    if (draftSession.dirty.value) {
      const choice = await feedback.choose({
        title: '跟随规格改名？',
        content: `${{ ship: '舰船', weapon: '武器', projectile: '弹体', system: '战术系统' }[change.before.kind as SpecEditorKind]}规格的 ID 已由 ${change.before.id} 改为 ${change.after.id}。\n\n${change.before.write.path === change.after.write.path ? change.after.write.path : '原文件：\n' + change.before.write.path + '\n\n新文件：\n' + change.after.write.path}\n\n跟随后继续保留当前修改和输入，采用新文件作为最后保存的内容。`,
        choices: [{ label: '保留编辑并跟随', value: 'follow', type: 'primary' }],
        cancelText: '稍后处理',
      });
      if (disposed || !sameEditorWindowTarget(target, editorWindowTarget())) return;
      if (choice !== 'follow')
        throw new AppError('规格身份交接尚未确认', { code: 'write.identity_pending', action: 'follow-saved-identity' });
    }
    const data = await definition.read(target.sessionId, change.after.id);
    if (disposed || !sameEditorWindowTarget(target, editorWindowTarget())) return;
    const nextTarget = { ...target, id: change.after.id };
    const next = deepClone(data.spec);
    await retargetEntityWindow(target.sessionId, target.modRoot, target.kind, nextTarget.id);
    draftSession.adoptIdentity(
      target,
      {
        target: nextTarget,
        value: next,
        baseVersions: data.baseVersions,
        meta: { data, receipt: null },
        requestId: event.result.requestId,
      },
      (draft) => (draftSession.dirty.value ? { ...draft, [definition.idField]: nextTarget.id } : next),
    );
  }

  function handleCommittedWriteEvent(change: CommittedWriteEvent) {
    const target = editorWindowTarget();
    const update = sessionContentUpdate(change, target?.sessionId);
    if (!update) return undefined;
    if (!target || update.manifest.sessionId !== target.sessionId) return undefined;

    if (normalizeFsPath(update.manifest.modRoot) !== normalizeFsPath(target.modRoot)) return undefined;
    const receipt = change.reason === 'refresh' ? null : change.result;
    if (receipt && !draftSession.acceptsSaveDelivery(target, receipt.requestId)) return undefined;
    if (
      receipt?.identityChanges.some(
        (identity) => identity.after.kind === target.kind && identity.after.id === target.id && identity.before.id !== identity.after.id,
      )
    )
      return undefined;
    const content = receipt?.content;
    const owner = content?.target.kind === 'spec' ? content.target.target : null;
    if (
      owner?.kind === target.kind &&
      owner.id === target.id &&
      receipt!.baseVersions.some((version) => normalizeFsPath(version.path) === normalizeFsPath(owner.write.path))
    ) {
      const spec = deepClone(requireRowData(content!.value, '规格保存返回内容无效'));
      const data = { ...editorData.value!, spec };
      draftSession.applyExternalForTarget(
        {
          target,
          value: spec,
          baseVersions: receipt!.baseVersions,
          requestId: receipt!.requestId,
          meta: { data: { ...data, target: owner, isNew: false, baseVersions: receipt!.baseVersions }, receipt: null },
        },
        true,
      );
      return undefined;
    }
    if (hasEntityInvalidation(update.invalidation, 'entity-detail', target.kind, target.id))
      return queryEditorData({ promptForMissing: false, showLoading: false });
    return undefined;
  }
  function editorWindowTarget(): SpecEditorTarget | null {
    if (!params.sessionId || !params.modRoot || !params.id) return null;
    return {
      sessionId: params.sessionId,
      modRoot: params.modRoot,
      kind: params.kind,
      id: draftSession.currentTarget.value?.id ?? params.id,
    };
  }

  return {
    problems,
    inputs: draftSession.inputs,
    refresh: (resources: readonly InvalidatedResourceScope[], paths: string[] = []) =>
      refreshProjectSourcePaths(
        params.sessionId!,
        params.modRoot!,
        [...editorData.value!.baseVersions.map((version) => version.path), ...paths],
        resources,
      ),
    currentTarget,
    schemaRuntimeContext,
    editorData,
    loading,
    contentReady: computed(() => editorData.value !== null),
    errorText,
    draftValue: draftSession.draftValue,
    previewValue: computed(() => editorData.value?.spec ?? draftSession.draftValue.value),
    commitInputs: () => draftSession.inputs.commit(),
    resetDraft: draftSession.resetDraft,
    draftDirty,
    editContext,
    waitForSave: draftSession.waitForSave,
    saving: draftSession.saving,
    draftSaving,
    handoffLocked: computed(() => false),
    canSaveSpec,
    externalUpdateNotice,
    missingEditorText,
    initializeEditorWindow,
    disposeEditorWindow,
    saveEditorData,
    updateEditorDraft,
    loadPendingExternalSpec,
  };
}

function sameEditorWindowTarget(left: SpecEditorTarget, right: SpecEditorTarget | null): boolean {
  return Boolean(right && editorWindowTargetKey(left) === editorWindowTargetKey(right));
}

function editorWindowTargetKey(target: SpecEditorTarget): string {
  return JSON.stringify([target.sessionId, normalizeFsPath(target.modRoot), target.kind, target.id]);
}
