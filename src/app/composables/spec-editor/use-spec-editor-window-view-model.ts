import { hasEntityInvalidation } from '@/services/entity-query.service';
import {
  refreshProjectSourcePaths,
  publishCommittedWrite,
  listenProjectChanges,
  projectChangeSessionId,
  listenEntityIdentityApplied,
} from '@/orchestrators/project-sync.orchestrator';
import { createEntitySavePreparation } from '@/orchestrators/edit-target-handoff.orchestrator';
import type { SpecEditorDefinition, SpecEditorTarget } from './spec-editor.types';
import { isReadInvalidated } from '@/shared/runtime/read-request';
import { computed, shallowRef, watch } from 'vue';
import { createSpecProblems } from './use-spec-problems';
import type { UnlistenFn } from '@/windows/tauri.events';
import { loadSpecEditorImport, saveSpecEditorSpecByKind } from '@/services/spec-editor.service';
import type { SpecEditorKind, RowData, WriteResult, SpecEditorData, ProjectChange } from '@/shared/types/index';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { deepClone } from '@/shared/lib/starsector/index';
import { AppError, formatError } from '@/shared/lib/errors';
import { requireRowData } from '@/shared/lib/row-data';
import { normalizeFsPath } from '@/shared/lib/paths';
import { captureIdentityVersions, handoffTableVersions } from '@/domain/project/entity-versions';

import { reserveEntityIntent, retargetEntityWindow, releaseCommittedIdentityTargets } from '@/orchestrators/entity-identity.orchestrator';

import type { EntityIdentityAppliedEvent } from '@/windows/window.events';
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
  let identityPreparation: Awaited<ReturnType<typeof createEntitySavePreparation>> | null = null;
  const draftSession: EditTargetDraftSession<RowData, SpecEditorTarget, { data: SpecEditorData; receipt: WriteResult<unknown> | null }> =
    useEditTargetDraftSession<RowData, SpecEditorTarget, { data: SpecEditorData; receipt: WriteResult<unknown> | null }>({
      emptyValue: {},
      load: async (target, signal) => {
        const data = await definition.read(target.sessionId, target.id, signal);
        return {
          target,
          meta: { data, receipt: null },
          baseVersions: data.baseVersions,
          value: definition.project(data),
        };
      },
      save: async (target, draft, baseVersions) => {
        problems.clearFailure();
        const context = draftSession.context.value;
        for (;;) {
          await draftSession.inputs.commit();
          if (draftSession.context.value !== context) return;
          draft = deepClone(draftSession.draftValue.value);
          const issues = problems.issues.value;
          if (issues.some((issue) => issue.severity === 'error')) throw new AppError('规格内容无效', { action: 'spec-validation' });
          const warnings = issues.filter((issue) => issue.severity === 'warning');
          if (!warnings.length) break;
          const checked = JSON.stringify([draft, warnings]);
          const choice = await feedback.choose({
            title: '仍有保存提醒',
            content: warnings.map((issue) => issue.message).join('\n'),
            choices: [{ label: '仍然保存', value: 'save', type: 'warning' }],
          });
          if (choice !== 'save' || draftSession.context.value !== context) return;
          await draftSession.inputs.commit();
          if (draftSession.context.value !== context) return;
          if (problems.issues.value.some((issue) => issue.severity === 'error'))
            throw new AppError('规格内容无效', { action: 'spec-validation' });
          if (
            checked ===
            JSON.stringify([draftSession.draftValue.value, problems.issues.value.filter((issue) => issue.severity === 'warning')])
          ) {
            draft = deepClone(draftSession.draftValue.value);
            break;
          }
        }
        const submittedData = deepClone(editorData.value!);
        const intent = await reserveEntityIntent(target.sessionId, target.modRoot, submittedData.target, draft);
        const versions = captureIdentityVersions(baseVersions, intent.destinationVersion);
        const result = await runConfirmedJsonWrite(feedback, (options) =>
          saveSpecEditorSpecByKind(target.sessionId, target.modRoot, submittedData.target, draft, options, versions),
        );
        if (!result) return;
        const value = result.content!.value;
        const savedTarget = result.identityChanges[0]!.after;
        return {
          target: { ...target, id: savedTarget.id },
          value,
          baseVersions: result.baseVersions,
          commitId: result.commitId,
          meta: {
            data: {
              ...definition.accept(submittedData, value),
              target: savedTarget,
              isNew: false,
              baseVersions: result.baseVersions,
            },
            receipt: result,
          },
        };
      },
      targetKey: editorWindowTargetKey,
      mapSaveError: (error) => problems.mapSaveError(error),
      afterSaved: () => problems.clearFailure(),
      withSavePreparation: async (target, submit) =>
        identityPreparation!.withPreparation(target.sessionId, target.modRoot, editorData.value!.target, async (info) => {
          if (info) {
            const nextTarget = { ...target, id: info.target.id };
            const previousId = target.id;
            const baseline = draftSession.baselineSnapshot.value!;
            const renamed = previousId !== nextTarget.id;
            const fresh = renamed ? await definition.read(target.sessionId, nextTarget.id) : editorData.value!;
            const value = renamed ? definition.project(fresh) : baseline.value;
            const versions = renamed ? fresh.baseVersions : handoffTableVersions(baseline.baseVersions, info);
            draftSession.adoptIdentity(
              target,
              {
                target: nextTarget,
                value,
                baseVersions: versions,
                meta: { data: { ...fresh, target: info.target, baseVersions: versions }, receipt: null },
              },
              (draft) =>
                previousId !== nextTarget.id && draft[definition.idField] === previousId
                  ? { ...draft, [definition.idField]: nextTarget.id }
                  : draft,
              previousId === nextTarget.id ? 'save' : 'external',
            );
            return submit(nextTarget);
          }
          return submit(target);
        }),
      acceptSaved: async (snapshot) => {
        await identityPreparation!.finish();
        await retargetEntityWindow(snapshot.target.sessionId, snapshot.target.modRoot, snapshot.target.kind, snapshot.target.id);
        await releaseCommittedIdentityTargets();
      },
      synchronizeSaved: async (snapshot) => {
        const result = snapshot.meta.receipt!;
        await publishCommittedWrite(snapshot.target.modRoot, result, snapshot.target.sessionId);
      },
    });
  const problems = createSpecProblems(draftSession.inputs, () => definition.validate?.(draftSession.draftValue.value) ?? []);
  watch(draftSession.context, () => problems.clearFailure(), { flush: 'sync' });
  const unregisterSave = useSaveCommandStore().registerSaveSession({
    targetKey: draftSession.currentTargetKey,
    modRoot: computed(() => params.modRoot),
    saving: draftSession.saving,
    pendingSynchronization: draftSession.hasPendingSynchronization,
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
  let unlistenChanges: UnlistenFn | null = null;
  let unlistenIdentity: UnlistenFn | null = null;
  let identityCommitId = -1;
  let disposed = false;
  const editorData = computed(() => {
    const data = draftSession.baselineSnapshot.value?.meta.data;
    return data ? definition.accept(data, draftSession.draftValue.value) : null;
  });
  const draftDirty = draftSession.dirty;
  const editContext = draftSession.context;
  const draftSaving = draftSession.saving;
  const externalUpdateNotice = draftSession.externalUpdateNotice;
  const canSaveSpec = computed(() => draftSession.ready.value);

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
      const snapshot = options.promptForMissing ? await draftSession.loadTarget(target) : await draftSession.refreshTarget(target);
      if (!snapshot?.meta) return;
      const data = snapshot.meta.data;
      if (data.isNew && options.promptForMissing) {
        const choice = await handleMissingSpec(params.kind, target);
        if (missingSpecIntent !== intent) return;
        if (choice.action === 'cancel') {
          void closeCurrentWindow();
          return;
        }
        if (choice.action === 'import') applyImportedSpec(choice.data);
      }
    } catch (error) {
      if (isReadInvalidated(error)) return;
      if (options.showLoading) {
        errorText.value = formatError(error);
        throw error;
      } else feedback.error(error, '刷新编辑器失败');
    }
  }

  async function handleMissingSpec(kind: SpecEditorKind, target: SpecEditorTarget): Promise<MissingSpecChoice> {
    const choice = await feedback.choose({
      title: `找不到 ${target.id} 的 spec`,
      content: '目标文件不存在，请选择操作：',
      choices: [
        { label: '新建文件', value: 'create', type: 'primary' },
        { label: '导入已有文件', value: 'import' },
      ],
    });
    if (!choice) return { action: 'cancel' };
    if (choice === 'import') {
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
    if (draftSession.saving.value) {
      await draftSession.waitForSave();
      return;
    }
    if (data) updateEditorDraft(data);
    try {
      const saved = await draftSession.saveDraft();
      if (saved) {
        feedback.success(`${target.id} 已保存`);
      }
    } catch (error) {
      feedback.error(error);
    }
  }

  function updateEditorDraft(data: RowData): void {
    const target = editorWindowTarget();
    if (!target || !editorData.value) return;
    draftSession.setDraft(data);
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
    confirmDiscard(draftSession.loadPendingExternal, draftSession.dirty.value, () => draftSession.currentTargetKey.value);
  }

  let setup: Promise<void> | null = null;
  async function initializeEditorWindow() {
    await (setup ??= setupEditorWindow());
    if (disposed) return;
    if (!draftSession.ready.value) await queryEditorData({ promptForMissing: true, showLoading: true });
    if (!draftSession.ready.value) throw new AppError('规格接纳已取消', { action: 'accept-window' });
  }
  async function setupEditorWindow() {
    identityPreparation = await createEntitySavePreparation(feedback, () => draftSession.currentTargetKey.value);
    if (disposed) {
      identityPreparation.dispose();
      return;
    }
    unlistenIdentity = await listenEntityIdentityApplied(handleIdentityApplied);
    if (disposed) {
      unlistenIdentity();
      unlistenIdentity = null;
      return;
    }
    unlistenChanges = await listenProjectChanges(handleProjectChange);
    if (disposed) unlistenChanges();
  }

  function disposeEditorWindow() {
    disposed = true;
    missingSpecIntent = null;
    identityPreparation?.dispose();
    unlistenIdentity?.();
    unlistenIdentity = null;
    unregisterSave();
    unlistenChanges?.();
    unlistenChanges = null;
    draftSession.dispose();
  }

  async function handleIdentityApplied(event: EntityIdentityAppliedEvent) {
    const target = editorWindowTarget();
    if (
      !target ||
      event.sessionId !== target.sessionId ||
      normalizeFsPath(event.modRoot) !== normalizeFsPath(target.modRoot) ||
      event.result.commitId <= identityCommitId
    )
      return;
    const change = event.result.identityChanges.find(
      (change) => change.before.kind === target.kind && change.before.id === target.id && change.after.id !== target.id,
    );
    if (!change) return;
    if (draftSession.saving.value && !(await draftSession.waitForSave())) return;
    if (disposed || !sameEditorWindowTarget(target, editorWindowTarget())) return;
    if (draftSession.dirty.value) {
      const choice = await feedback.choose({
        title: '跟随实体重命名？',
        content: '保留当前草稿和活动输入，并接纳新的正式身份与文件基线。',
        choices: [{ label: '保留编辑并跟随', value: 'follow', type: 'primary' }],
      });
      if (choice !== 'follow' || disposed || !sameEditorWindowTarget(target, editorWindowTarget())) return;
    }
    const data = await definition.read(target.sessionId, change.after.id);
    if (disposed || !sameEditorWindowTarget(target, editorWindowTarget())) return;
    const nextTarget = { ...target, id: change.after.id };
    const next = definition.project(data);
    await retargetEntityWindow(target.sessionId, target.modRoot, target.kind, nextTarget.id);
    const accepted = draftSession.adoptIdentity(
      target,
      {
        target: nextTarget,
        value: next,
        baseVersions: data.baseVersions,
        meta: { data, receipt: null },
        commitId: event.result.commitId,
      },
      (draft) => (draftSession.dirty.value ? { ...draft, [definition.idField]: nextTarget.id } : next),
    );
    if (accepted) identityCommitId = event.result.commitId;
  }

  function handleProjectChange(change: ProjectChange) {
    const target = editorWindowTarget();
    if (!target || projectChangeSessionId(change) !== target.sessionId) return;
    if (change.kind === 'closed') {
      missingSpecIntent = null;
      draftSession.cancelRead();
      return;
    }
    if (normalizeFsPath(change.projection.manifest.modRoot) !== normalizeFsPath(target.modRoot)) return;
    const receipt = change.kind === 'commit' ? change.event.result : null;
    if (receipt && !draftSession.isTargetCommitCurrent(target, receipt.commitId)) return;
    const content = receipt?.content;
    const owner = content?.target.kind === 'spec' ? content.target.target : null;
    if (
      owner?.kind === target.kind &&
      owner.id === target.id &&
      receipt!.baseVersions.some((version) => normalizeFsPath(version.path) === normalizeFsPath(owner.write.path))
    ) {
      const spec = deepClone(requireRowData(content!.value, '规格保存返回内容无效'));
      const data = definition.accept(editorData.value!, spec);
      draftSession.applyExternalForTarget({
        target,
        value: spec,
        baseVersions: receipt!.baseVersions,
        commitId: receipt!.commitId,
        meta: { data: { ...data, target: owner, isNew: false, baseVersions: receipt!.baseVersions }, receipt },
      });
      return;
    }
    if (hasEntityInvalidation(change.projection.invalidation, 'entity-detail', target.kind, target.id))
      void queryEditorData({ promptForMissing: false, showLoading: false });
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
    refresh: (resources: readonly import('@/shared/types/index').InvalidatedResourceScope[], paths: string[] = []) =>
      refreshProjectSourcePaths(
        params.sessionId!,
        params.modRoot!,
        [...editorData.value!.baseVersions.map((version) => version.path), ...paths],
        resources,
      ),
    currentTarget: computed(editorWindowTarget),
    editorData,
    loading,
    contentReady: computed(() => editorData.value !== null),
    errorText,
    draftValue: draftSession.draftValue,
    commitInputs: () => draftSession.inputs.commit(),
    resetDraft: draftSession.resetDraft,
    draftDirty,
    editContext,
    waitForSave: draftSession.waitForSave,
    saving: draftSession.saving,
    draftSaving,
    handoffLocked: computed(() => useSaveCommandStore().isEditTargetLocked(draftSession.currentTargetKey.value)),
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
