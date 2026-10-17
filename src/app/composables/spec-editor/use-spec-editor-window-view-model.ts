import { hasEntityInvalidation } from '@/services/entity-query.service';
import {
  refreshProjectSourcePaths,
  invalidateProjectionCaches,
  listenProjectSessionInvalidated,
  listenEntityIdentityApplied,
} from '@/orchestrators/project-sync.orchestrator';
import { createEntitySavePreparation } from '@/orchestrators/edit-target-handoff.orchestrator';
import type { SpecEditorDefinition, SpecEditorTarget } from './spec-editor.types';
import { isReadInvalidated } from '@/shared/runtime/read-request';
import { computed, shallowRef } from 'vue';
import type { UnlistenFn } from '@/windows/tauri.events';
import { loadSpecEditorImport, saveSpecEditorSpecByKind } from '@/services/spec-editor.service';
import type { SpecEditorKind, RowData, WriteResult, SpecEditorData } from '@/shared/types/index';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { deepClone } from '@/shared/lib/starsector/index';
import { AppError, formatError } from '@/shared/lib/errors';
import { normalizeFsPath } from '@/shared/lib/paths';
import { captureIdentityVersions, handoffTableVersions } from '@/domain/project/entity-versions';
import { emitEditorSpecSaved, listenEditorSpecSaved } from '@/orchestrators/editor-window.orchestrator';

import { reserveEntityIntent, retargetEntityWindow, releaseCommittedIdentityTargets } from '@/orchestrators/entity-identity.orchestrator';

import type { EntityIdentityAppliedEvent, EditorSpecSavedEvent, ProjectSessionInvalidatedEvent } from '@/windows/window.events';
import { runConfirmedJsonWrite } from '@/orchestrators/json-write-confirmation.orchestrator';
import { subscribeQueryInvalidations } from '@/services/query-cache.service';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useEditTargetDraftSession, type EditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { pickEditorSpecFile } from '@/shared/runtime/dialog.runtime';
import { closeCurrentWindow } from '@/windows/current.window';
import type { QueryCacheInvalidationEvent } from '@/services/query-cache.service';

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
  const completedLocalWrites = new Set<number>();
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
        const submittedData = deepClone(editorData.value!);
        const intent = await reserveEntityIntent(target.sessionId, target.modRoot, submittedData.target, draft);
        const versions = captureIdentityVersions(baseVersions, intent.destinationVersion);
        const result = await runConfirmedJsonWrite(feedback, (options) =>
          saveSpecEditorSpecByKind(target.sessionId, target.modRoot, submittedData.target, draft, options, versions),
        );
        if (!result) return;
        const value = result.refreshedEntity!;
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
      afterSaved: async (snapshot) => {
        const result = snapshot.meta.receipt!;
        if (!completedLocalWrites.has(result.commitId)) {
          await identityPreparation!.finish();
          await retargetEntityWindow(snapshot.target.sessionId, snapshot.target.modRoot, snapshot.target.kind, snapshot.target.id);
          await releaseCommittedIdentityTargets();
          completedLocalWrites.add(result.commitId);
        }
        await emitEditorSpecSaved({
          kind: snapshot.target.kind,
          sessionId: snapshot.target.sessionId,
          modRoot: snapshot.target.modRoot,
          id: snapshot.target.id,
          spec: snapshot.value,
          writeResult: result,
        });
      },
    });
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
        return { saved: Boolean(snapshot), receipt: snapshot?.meta.receipt ?? null };
      },
    },
  });
  const loading = draftSession.loading;
  const { confirmDiscard } = useFieldInputActions(draftSession.inputs);
  const errorText = shallowRef('');
  let unlistenEditorSpecSaved: UnlistenFn | null = null;
  let unlistenIdentity: UnlistenFn | null = null;
  let identityCommitId = -1;
  let stopSessionInvalidated: UnlistenFn | null = null;
  let stopQueryInvalidation: (() => void) | null = null;
  let disposed = false;
  const editorData = computed(() => {
    const data = draftSession.baselineSnapshot.value?.meta.data;
    return data ? definition.accept(data, draftSession.draftValue.value) : null;
  });
  const draftDirty = draftSession.dirty;
  const editContext = draftSession.context;
  const draftSaving = draftSession.saving;
  const externalUpdateNotice = draftSession.externalUpdateNotice;
  const canSaveSpec = computed(
    () =>
      draftSession.ready.value && (draftSession.hasPendingSynchronization.value || draftDirty.value || Boolean(editorData.value?.isNew)),
  );

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
    const spec = deepClone(data);
    draftSession.setDraft(spec);
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
    const spec = deepClone(data);
    draftSession.setDraft(spec);
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
    unlistenEditorSpecSaved = await listenEditorSpecSaved(handleEditorSpecSaved);
    if (disposed) {
      unlistenEditorSpecSaved();
      unlistenEditorSpecSaved = null;
      return;
    }
    stopSessionInvalidated = await listenProjectSessionInvalidated(onProjectSessionInvalidated);
    if (disposed) {
      stopSessionInvalidated();
      stopSessionInvalidated = null;
      return;
    }
    stopQueryInvalidation = subscribeQueryInvalidations(handleQueryCacheInvalidated);
  }

  function disposeEditorWindow() {
    disposed = true;
    missingSpecIntent = null;
    identityPreparation?.dispose();
    unlistenIdentity?.();
    unlistenIdentity = null;
    unregisterSave();
    unlistenEditorSpecSaved?.();
    unlistenEditorSpecSaved = null;
    stopSessionInvalidated?.();
    stopSessionInvalidated = null;
    stopQueryInvalidation?.();
    stopQueryInvalidation = null;
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

  function handleEditorSpecSaved(event: EditorSpecSavedEvent) {
    const target = editorWindowTarget();
    if (
      !target ||
      event.sessionId !== target.sessionId ||
      normalizeFsPath(event.modRoot) !== normalizeFsPath(target.modRoot) ||
      !editorData.value
    )
      return;
    if (event.kind === target.kind && event.id === target.id) receiveExternalPrimarySpec(event.spec, event.writeResult);
  }

  function onProjectSessionInvalidated(event: ProjectSessionInvalidatedEvent) {
    const target = editorWindowTarget();
    if (
      !target ||
      event.manifest.sessionId !== target.sessionId ||
      normalizeFsPath(event.manifest.modRoot) !== normalizeFsPath(target.modRoot)
    )
      return;
    invalidateProjectionCaches(event);
  }

  function handleQueryCacheInvalidated(event: QueryCacheInvalidationEvent) {
    const target = editorWindowTarget();
    if (!target || event.sessionId !== target.sessionId) return;
    if (event.scope === 'session') {
      missingSpecIntent = null;
      return;
    }
    if (hasEntityInvalidation(event, 'entity-detail', params.kind, target.id)) {
      void queryEditorData({ promptForMissing: false, showLoading: false });
      return;
    }
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
    refresh: (resources: readonly import('@/shared/types/index').InvalidatedResourceScope[]) =>
      refreshProjectSourcePaths(
        params.sessionId!,
        params.modRoot!,
        editorData.value!.baseVersions.map((version) => version.path),
        resources,
      ),
    currentTarget: computed(editorWindowTarget),
    editorData,
    loading,
    contentReady: computed(() => editorData.value !== null),
    errorText,
    draftValue: draftSession.draftValue,
    commitInputs: () => draftSession.inputs.commit(),
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

  function receiveExternalPrimarySpec(data: RowData, result: WriteResult<unknown>): void {
    if (!editorData.value) return;
    const spec = deepClone(data);
    const target = editorWindowTarget();
    if (!target) return;
    draftSession.applyExternalForTarget({
      target,
      value: spec,
      baseVersions: result.baseVersions,
      commitId: result.commitId,
      meta: { data: definition.accept(editorData.value, spec), receipt: result },
    });
  }
}

function sameEditorWindowTarget(left: SpecEditorTarget, right: SpecEditorTarget | null): boolean {
  return Boolean(right && editorWindowTargetKey(left) === editorWindowTargetKey(right));
}

function editorWindowTargetKey(target: SpecEditorTarget): string {
  return JSON.stringify([target.sessionId, normalizeFsPath(target.modRoot), target.kind, target.id]);
}
