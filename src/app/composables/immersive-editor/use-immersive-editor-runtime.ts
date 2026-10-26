import { hasSourceInvalidation } from '@/services/source-options.service';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { refreshProjectSourcePaths, listenEntityIdentityApplied } from '@/orchestrators/project-sync.orchestrator';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { JointEditRoot, JointEditSnapshot, JointValue } from '@/shared/types';
import { useJointEditSession } from '../use-joint-edit-session';
import { useSnapshotHistory } from '../use-snapshot-history';
import { useQueryReadOwner } from '../use-query-read-owner';
import { useAppFeedback } from '../use-app-feedback';
import { useResourceMediaRegistry } from '../use-resource-media-registry';
import { useSettingsStore } from '@/stores/settings.store';
import type { ImmersiveEditorDefinition, ImmersivePanelState } from '@/domain/immersive/fields';

import { updateImmersiveField, type ImmersiveField, type ImmersiveFieldChange } from '@/domain/immersive/fields';
import type { SchemaFieldUpdate } from '@/domain/schema/schema.types';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import { mapJointDraftIdentity, rebaseJointDraft } from '@/domain/joint-edit';
import { queryJointEdit, queryJointEditRow, queryJointEditProjection } from '@/services/joint-edit.service';
import { querySourceOptionCatalog } from '@/services/source-options.service';
import { subscribeQueryInvalidations } from '@/services/query-cache.service';
import { retargetImmersiveWindow } from '@/orchestrators/immersive-editor.orchestrator';

import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { AppError, formatError, warningNotice } from '@/shared/lib/errors';
import { normalizeFsPath, joinRootRelativePath, isAbsoluteFsPath, pathBelongsToRoot } from '@/shared/lib/paths';
import { querySessionHullReferences } from '@/services/hull-reference.service';
import { hullReferenceSourceGroups } from '@/domain/resources/hull-references';
import { recordLogBestEffort } from '@/services/app-log.service';
import { logFields } from '@/shared/lib/log-fields';

export function useImmersiveEditorRuntime<TPanel extends ImmersivePanelState>(
  root: JointEditRoot & { rowKey?: string },
  definition: ImmersiveEditorDefinition<TPanel>,
  hooks: Pick<NonNullable<Parameters<typeof useJointEditSession>[0]>, 'readSnapshot' | 'onProjection'>,
) {
  const feedback = useAppFeedback();
  const settings = useSettingsStore();
  const reads = useQueryReadOwner();
  let windowCommit = -1;
  let active = true;
  let selectionIntent: object | null = null;
  let stopIdentity: (() => void) | null = null;
  const selectedStatId = ref<string | null>(null);
  const errorText = ref('');
  const projection = shallowRef<{
    baseline: JointEditSnapshot;
    graph: JointEditSnapshot;
    values: Record<string, JointValue>;
  } | null>(null);
  const referenceChanging = ref(false);
  const joint = useJointEditSession({
    editableRecords: definition.editableRecords,
    ...hooks,
    readSnapshot: async (target, signal) => {
      errorText.value = '';
      try {
        return await (hooks.readSnapshot ?? queryJointEdit)(target, signal);
      } catch (error) {
        if (active && !signal?.aborted) errorText.value = formatError(error);
        throw error;
      }
    },
    afterBaseline: async (snapshot, receipt, previous) => {
      if (receipt.commitId <= windowCommit) return;
      await retargetImmersiveWindow(snapshot);
      history.rebase((value) => mapJointDraftIdentity(value, previous, snapshot, receipt.identityChanges, receipt.keyMap));
      windowCommit = receipt.commitId;
    },
  });
  const history = useSnapshotHistory<Record<string, JointValue>>(
    joint.context,
    computed(() => settings.editHistoryLimit),
  );
  const snapshot = computed(() => joint.baselineSnapshot.value?.meta.snapshot ?? null);
  const displaySnapshot = computed(() => (projection.value?.baseline === snapshot.value ? projection.value.graph : snapshot.value));
  const displayValues = computed(() => {
    if (!definition.retainDisplayReferences || !snapshot.value) return joint.draftValue.value;
    const accepted = projection.value?.baseline === snapshot.value ? projection.value.values : joint.baselineSnapshot.value!.value;
    return stableDeepEqual(definition.references(snapshot.value, accepted), definition.references(snapshot.value, joint.draftValue.value))
      ? joint.draftValue.value
      : accepted;
  });
  const panel = computed(() => (snapshot.value ? definition.project(snapshot.value, displayValues.value, displaySnapshot.value) : null));
  const notices = computed(() =>
    snapshot.value
      ? snapshot.value.records.filter(
          (record) =>
            definition.editableRecords(snapshot.value!).includes(record.key) &&
            (record.source?.source === 'core' || record.value.state === 'missing'),
        )
      : [],
  );
  const runtimeContext = computed<SchemaRuntimeContext>(() => ({
    sessionId: joint.currentTarget.value?.sessionId ?? root.sessionId,
    modRoot: root.modRoot,
    sourceContextKey: joint.currentTargetKey.value ?? '',
    querySourceOptions: async (source, signal) =>
      source === 'hull:ids'
        ? hullReferenceSourceGroups(await querySessionHullReferences(root.sessionId, [], signal))
        : querySourceOptionCatalog(root.sessionId, source, signal),
    subscribeSourceOptionInvalidation: (source, _resources, listener) =>
      subscribeQueryInvalidations((event) => {
        if (
          event.sessionId === root.sessionId &&
          (source === 'hull:ids'
            ? event.invalidation?.queryScopes.some((scope) => scope.kind === 'hull-references')
            : hasSourceInvalidation(event, source))
        )
          listener();
      }),
  }));
  const media = useResourceMediaRegistry({
    onError: (error) => feedback.error(error),
    onFailures: (resources) => {
      const missing = resources.filter((resource) => resource.ownerId !== 'damage-type');
      if (missing.length)
        feedback.warning(
          warningNotice(
            `贴图读取失败：${missing.map((resource) => resource.relPath).join('、')}`,
            'resource.read_failed',
            `Resource read failed: count=${missing.length}; surface=immersive`,
          ),
        );
    },
  });
  const mediaUrl = (resource: import('@/shared/types').ResourceRef | null | undefined) => media.dataUrl(root.sessionId, resource) ?? '';
  watch(
    () => (panel.value ? definition.media(panel.value) : []),
    (resources) => {
      void media.replaceCollection(root.sessionId, 'immersive-preview', resources);
    },
  );
  function referenceKey() {
    if (!snapshot.value) return '';
    return JSON.stringify([joint.currentTargetKey.value, ...definition.references(snapshot.value, joint.draftValue.value)]);
  }
  const referenceSelection = computed(referenceKey);
  watch([referenceSelection, snapshot], () => {
    reads.revoke('consumer', 'projection');
    reads.schedule('projection', () => {
      void refreshProjection(Boolean(joint.baselineSnapshot.value?.meta.receipt));
    });
  });
  async function refreshProjection(force = false) {
    const baseline = snapshot.value;
    if (!baseline) return;
    const values = deepClone(joint.draftValue.value);
    const original = joint.baselineSnapshot.value!.value;
    if (!force && stableDeepEqual(definition.references(baseline, values), definition.references(baseline, original))) {
      projection.value = { baseline, graph: baseline, values };
      return;
    }
    await reads.consume('projection', { root: baseline.root, values }, (signal) => queryJointEditProjection({ baseline, values }, signal), {
      ready: (value) => {
        projection.value = { baseline, graph: cloneQuerySnapshot<JointEditSnapshot>(value), values };
      },
      error: (error) => feedback.error(error, '关联来源读取失败'),
    });
  }
  const stopProjection = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== root.sessionId) return;
    if (event.scope === 'session') {
      reads.revoke('session');
      projection.value = null;
      dismissStat();
      errorText.value = '所属会话已关闭';
      return;
    }
    const current = snapshot.value;
    if (!current || !event.invalidation) return;
    const owned = [
      ...current.records.flatMap((record) => [...record.baseVersions, ...(record.sourceVersion ? [record.sourceVersion] : [])]),
      ...current.referenceSettings.versions,
    ].map((version) => version.path);
    const changed = event.invalidation.paths.map((path) => (isAbsoluteFsPath(path) ? path : joinRootRelativePath(root.modRoot, path)));
    if (
      event.invalidation.session ||
      changed.some((path) => owned.some((own) => pathBelongsToRoot(own, path) || pathBelongsToRoot(path, own)))
    )
      reads.schedule('projection', () => {
        void refreshProjection(true);
      });
  });
  function editable(field: ImmersiveField) {
    return snapshot.value?.records.find((record) => record.key === field.recordKey)?.source?.source !== 'core';
  }
  function updateField(field: ImmersiveField, update: SchemaFieldUpdate) {
    updateFields([{ field, update }]);
  }

  function updateFields(changes: ImmersiveFieldChange[]) {
    if (changes.some((change) => change.field.handoff)) return switchReference(changes).then(() => undefined);
    const before = deepClone(joint.draftValue.value);
    let after = before;
    for (const { field, update } of changes) {
      const record = snapshot.value!.records.find((record) => record.key === field.recordKey)!;
      after = (definition.updateField ?? updateImmersiveField)(after, record, field, update);
    }
    joint.setDraft(after);
    history.push(before, after);
  }
  function dismissStat() {
    selectionIntent = null;
    selectedStatId.value = null;
  }
  async function toggleStat(id: string, show: boolean) {
    const intent = {};
    selectionIntent = intent;
    if (selectedStatId.value && selectedStatId.value !== (show ? id : null)) {
      try {
        const result = await joint.inputs.commit(JSON.stringify(['immersive', selectedStatId.value]));
        if (result === false) return;
      } catch (error) {
        feedback.error(error);
        return;
      }
    }
    if (active && selectionIntent === intent) selectedStatId.value = show ? id : null;
  }
  async function save() {
    try {
      const result = await joint.saveDraft();
      if (result) feedback.success(`${definition.label}联合保存完成`);
    } catch (error) {
      feedback.error(error);
    }
  }
  async function createOverrides(selected?: string[]) {
    const target = joint.currentTarget.value;
    const admitted = joint.inputs.captureContext();
    const keys = selected ?? notices.value.filter((record) => record.source?.source === 'core').map((record) => record.key);
    try {
      if (!active || !admitted() || joint.currentTarget.value !== target) return;
      await joint.createOverrides(keys);
    } catch (error) {
      feedback.error(error);
    }
  }
  async function switchReference(changes: ImmersiveFieldChange[], inputCommitted = false) {
    const key = joint.currentTargetKey.value;
    referenceChanging.value = true;
    let previous: Record<string, JointValue> | null = null;
    try {
      const submitting = inputCommitted && joint.saving.value;
      if (!submitting && (!(await joint.waitForSave()) || (await joint.inputs.commit()) === false)) return;
      if (!active || joint.currentTargetKey.value !== key) return;
      if (!submitting && joint.dirty.value) {
        const choice = await feedback.choose({
          title: '保存后切换关联来源？',
          content: `保存当前${definition.label}及关联来源的编辑，再接入所选来源。`,
          choices: [{ label: '保存并切换', value: 'save', type: 'primary' }],
        });
        if (choice !== 'save' || !active || joint.currentTargetKey.value !== key) return;
        if (!(await joint.saveDraft()) || joint.dirty.value || !active || joint.currentTargetKey.value !== key) return;
      }
      previous = deepClone(joint.draftValue.value);
      let next = previous;
      for (const { field, update } of changes)
        next = updateImmersiveField(
          next,
          snapshot.value!.records.find((record) => record.key === field.recordKey)!,
          field,
          update,
        );
      joint.setDraft(next);
      if (submitting) {
        previous = null;
        return true;
      }
      const saved = await joint.saveDraft();
      if (!saved) {
        joint.setDraft(previous);
        return;
      }
      previous = null;
      if (active && joint.currentTargetKey.value === key) {
        dismissStat();
        await joint.refreshTarget(joint.currentTarget.value!);
        return true;
      }
    } catch (error) {
      if (previous && active && joint.currentTargetKey.value === key && !joint.hasPendingSynchronization.value) joint.setDraft(previous);
      feedback.error(error, '切换关联来源失败');
    } finally {
      referenceChanging.value = false;
    }
  }
  async function undo() {
    try {
      const result = await joint.inputs.commit();
      if (result === false) return;
      dismissStat();
      const value = history.undo();
      if (value) joint.setDraft(value);
    } catch (error) {
      feedback.error(error);
    }
  }
  async function redo() {
    try {
      const result = await joint.inputs.commit();
      if (result === false) return;
      dismissStat();
      const value = history.redo();
      if (value) joint.setDraft(value);
    } catch (error) {
      feedback.error(error);
    }
  }
  let initialization: Promise<void> | null = null;
  function logSlowPreparation() {
    recordLogBestEffort({
      level: 'warning',
      code: 'immersive.preparation_slow',
      message: 'immersive editor preparation exceeded 12 seconds',
      path: null,
      line: null,
      fields: logFields({ ...root, ...joint.currentTarget.value, waitMs: 12000, phase: referenceChanging.value ? 'reference' : 'read' }),
    });
  }
  async function retry() {
    try {
      if (joint.ready.value) await joint.refreshTarget(joint.currentTarget.value!);
      else await initialize();
    } catch (error) {
      if (active) errorText.value = formatError(error);
    }
  }
  function initialize(rowKey?: string | null) {
    if (rowKey && rowKey !== root.rowKey) {
      if (joint.dirty.value) return Promise.reject(new AppError('请先保存当前行的编辑，再接纳新的行身份', { action: 'accept-window' }));
      root.rowKey = rowKey;
      joint.clearTarget();
    }
    if (joint.ready.value) return Promise.resolve();
    return (initialization ??= loadInitial().finally(() => {
      initialization = null;
    }));
  }
  async function loadInitial() {
    stopIdentity?.();
    stopIdentity = null;
    const stop = await listenEntityIdentityApplied(async (event) => {
      const target = joint.currentTarget.value;
      if (
        !target ||
        event.sessionId !== target.sessionId ||
        normalizeFsPath(event.modRoot) !== normalizeFsPath(target.modRoot) ||
        !joint.isTargetCommitCurrent(target, event.result.commitId)
      )
        return;
      const change = event.result.identityChanges.find(
        (change) =>
          change.before.kind === root.kind &&
          change.before.id !== change.after.id &&
          (change.before.id === target.id ||
            (root.kind === 'variant' &&
              snapshot.value?.records.some(
                (record) =>
                  record.target.kind === 'spec' &&
                  record.target.target.kind === 'variant' &&
                  record.target.target.id === change.before.id &&
                  definition.editableRecords(snapshot.value!).includes(record.key),
              ))),
      );
      if (!change) return;
      if (joint.saving.value && !(await joint.waitForSave())) return;
      if (!joint.isTargetCommitCurrent(target, event.result.commitId)) return;
      if (joint.dirty.value) {
        const choice = await feedback.choose({
          title: `跟随${definition.label}重命名？`,
          content: '保留当前草稿、活动输入和历史，并接纳新的正式身份。',
          choices: [{ label: '保留编辑并跟随', value: 'follow', type: 'primary' }],
        });
        if (choice !== 'follow' || !joint.isTargetCommitCurrent(target, event.result.commitId)) return;
      }
      let captured: JointEditSnapshot | null = null;
      const accepted = await reads.consume(
        'identity',
        { target, commitId: event.result.commitId },
        (signal) =>
          change.after.linkedRecord?.kind === 'csv'
            ? queryJointEditRow(target, change.after.linkedRecord.rowKey, signal)
            : queryJointEdit({ ...target, id: change.before.id === target.id ? change.after.id : target.id }, signal),
        {
          ready: (value) => {
            captured = cloneQuerySnapshot<JointEditSnapshot>(value);
          },
        },
      );
      if (!accepted || !captured || !joint.isTargetCommitCurrent(target, event.result.commitId)) return;
      const next: JointEditSnapshot = captured;
      await retargetImmersiveWindow(next);
      const previous = snapshot.value;
      const nextValues = Object.fromEntries(
        next.records.filter((record) => definition.editableRecords(next).includes(record.key)).map((record) => [record.key, record.value]),
      );
      const map = previous
        ? (values: Record<string, JointValue>) =>
            rebaseJointDraft(values, previous, next, event.result.identityChanges, event.result.keyMap)
        : () => nextValues;
      if (
        joint.adoptIdentity(
          target,
          {
            target: next.root,
            value: nextValues,
            baseVersions: next.baseVersions,
            meta: { snapshot: next, receipt: null, previous: null },
            commitId: event.result.commitId,
          },
          map,
          'identity',
        )
      )
        history.rebase(map);
    });
    if (!active) {
      stop();
      return;
    }
    stopIdentity = stop;
    errorText.value = '';
    try {
      if (!(await joint.loadTarget(root)) && !joint.ready.value) throw new AppError('联合编辑读取已结束', { action: 'accept-window' });
      if (root.kind === 'wing' && snapshot.value && snapshot.value.root.id !== root.id) await retargetImmersiveWindow(snapshot.value);
    } catch (error) {
      errorText.value = formatError(error);
      throw error;
    }
  }
  onScopeDispose(() => {
    active = false;
    projection.value = null;
    selectionIntent = null;
    stopIdentity?.();
    stopProjection();
  });
  useContextMenuScope({
    identity: () => joint.currentTargetKey.value ?? '',
    canRefresh: () => Boolean(snapshot.value),
    refresh: async (current) => {
      const graph = displaySnapshot.value!;
      await refreshProjectSourcePaths(
        root.sessionId,
        root.modRoot,
        [...graph.baseVersions, ...graph.referenceSettings.versions].map((version) => version.path),
        [...graph.records.flatMap((record) => Object.values(record.resourceRefs)), ...Object.values(graph.referenceSettings.resources)],
      );
      if (current()) await joint.refreshTarget(joint.currentTarget.value!);
    },
  });
  function loadExternal() {
    const key = joint.currentTargetKey.value;
    feedback.confirmWarning({
      title: '载入外部版本？',
      content: '载入外部版本并重新建立当前编辑基线。',
      actionText: '载入',
      onConfirm: async () => {
        if (!(await joint.waitForSave())) return;
        if (active && joint.currentTargetKey.value === key) {
          dismissStat();
          joint.loadPendingExternal();
        }
      },
    });
  }
  return {
    label: definition.label,
    root,
    joint,
    referenceChanging,
    snapshot,
    displaySnapshot,
    displayValues,
    panel,
    notices,
    runtimeContext,
    mediaUrl,
    errorText,
    selectedStatId,
    history,
    editable,
    updateField,
    updateFields,
    switchReference,
    toggleStat,
    dismissStat,
    save,
    createOverrides,
    undo,
    redo,
    initialize,
    retry,
    logSlowPreparation,
    loadExternal,
    reads,
    isActive: () => active,
  };
}

export type ImmersiveEditorRuntime = ReturnType<typeof useImmersiveEditorRuntime>;
