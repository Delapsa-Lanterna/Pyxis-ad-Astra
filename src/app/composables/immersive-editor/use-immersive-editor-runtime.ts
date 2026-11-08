import { dialogBody, dialogFiles } from '@/shared/ui/dialog-content';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { isExternalSource } from '@/shared/lib/resource-ref';
import { hasSourceInvalidation } from '@/services/source-catalog.service';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import {
  refreshProjectSourcePaths,
  listenSavedIdentity,
  observeSavedContent,
  sessionContentUpdate,
} from '@/orchestrators/project-sync.orchestrator';
import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { JointEditRoot, JointEditSnapshot, JointValue, RowData, ResourceRef } from '@/shared/types';
import { useJointEditSession } from '../use-joint-edit-session';
import { useSnapshotHistory } from '../use-snapshot-history';
import { useQueryReadOwner } from '../use-query-read-owner';
import { useAppFeedback } from '../use-app-feedback';
import { useResourceMediaRegistry } from '../use-resource-media-registry';
import { useSettingsStore } from '@/stores/settings.store';
import type { ImmersiveEditorDefinition, ImmersivePanel } from '@/domain/immersive/fields';

import { immersiveFieldValue, updateImmersiveField, type ImmersiveField, type ImmersiveFieldChange } from '@/domain/immersive/fields';
import type { SchemaFieldUpdate } from '@/domain/schema/schema.types';
import type { FieldEditorContext } from '@/domain/field-editor/field-editor-context';
import { jointWriteTargets, mapJointDraftIdentity, rebaseJointDraft } from '@/domain/joint-edit';
import { queryJointEdit, queryJointEditRow, queryJointEditPreview } from '@/services/joint-edit.service';
import { querySourceOptionCatalog } from '@/services/source-catalog.service';

import { retargetImmersiveWindow } from '@/orchestrators/immersive-editor.orchestrator';

import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { AppError, formatError, warningNotice } from '@/shared/lib/errors';
import { normalizeFsPath } from '@/shared/lib/paths';
import { querySessionHullReferences } from '@/services/hull-reference.service';
import { hullReferenceSourceGroups } from '@/domain/resources/hull-references';
import { recordLogBestEffort } from '@/services/app-log.service';
import { logFields } from '@/shared/lib/log-fields';
import { composeJson, replacesBase } from '@/domain/json-composition';

function jointValueData(value: JointValue | undefined) {
  return value?.state === 'present' ? value.value : undefined;
}

export function useImmersiveEditorRuntime<TPanel extends ImmersivePanel>(
  root: JointEditRoot & { rowKey?: string },
  definition: ImmersiveEditorDefinition<TPanel>,
  hooks: Pick<NonNullable<Parameters<typeof useJointEditSession>[0]>, 'readSnapshot' | 'onContentUpdate' | 'validate'>,
) {
  const feedback = useAppFeedback();
  const settings = useSettingsStore();
  const reads = useQueryReadOwner();
  let active = true;
  let selectionIntent: object | null = null;
  let stopIdentity: (() => void) | null = null;
  const selectedStatId = ref<string | null>(null);
  const errorText = ref('');
  const preview = shallowRef<{
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
      await retargetImmersiveWindow(snapshot);
      history.rebase((value) => mapJointDraftIdentity(value, previous, snapshot, receipt.identityChanges, receipt.keyMap));
      await refreshPreview(true);
    },
  });
  const history = useSnapshotHistory<Record<string, JointValue>>(
    joint.context,
    computed(() => settings.editHistoryLimit),
  );
  const snapshot = computed(() => joint.baselineSnapshot.value?.meta.snapshot ?? null);
  const displaySnapshot = computed(() => (preview.value?.baseline === snapshot.value ? preview.value.graph : snapshot.value));
  const displayValues = computed(() => {
    if (!definition.retainPreviewContent || !snapshot.value) return joint.draftValue.value;
    const accepted = preview.value?.baseline === snapshot.value ? preview.value.values : joint.baselineSnapshot.value!.value;
    return stableDeepEqual(
      definition.previewInputs(snapshot.value, accepted),
      definition.previewInputs(snapshot.value, joint.draftValue.value),
    )
      ? joint.draftValue.value
      : accepted;
  });
  const panel = computed(() => {
    if (!snapshot.value) return null;
    const values = { ...displayValues.value };
    for (const record of snapshot.value.records) {
      const value = values[record.key];
      if (record.composition && value?.state === 'present')
        values[record.key] = { state: 'present', value: composeJson(value.value as RowData, record.composition) };
    }
    return definition.project(snapshot.value, values, displaySnapshot.value);
  });
  const notices = computed(() =>
    snapshot.value
      ? snapshot.value.records.filter(
          (record) =>
            definition.editableRecords(snapshot.value!).includes(record.key) &&
            (isExternalSource(record.source?.source) || record.value.state === 'missing'),
        )
      : [],
  );
  const runtimeContext = computed<FieldEditorContext>(() => ({
    sessionId: joint.currentTarget.value?.sessionId ?? root.sessionId,
    modRoot: root.modRoot,
    sourceContextKey: joint.currentTargetKey.value ?? '',
    querySourceOptions: async (source, signal) =>
      source === 'hull:ids'
        ? hullReferenceSourceGroups(await querySessionHullReferences(root.sessionId, [], signal))
        : querySourceOptionCatalog(root.sessionId, source, signal),
    subscribeSourceOptionInvalidation: (source, _resources, listener) =>
      observeSavedContent(
        (event) => {
          const update = sessionContentUpdate(event, root?.sessionId);
          if (!update) return;

          if (
            update.manifest.sessionId === root.sessionId &&
            (source === 'hull:ids'
              ? update.invalidation.session || update.invalidation.queryScopes.some((scope) => scope.kind === 'hull-references')
              : hasSourceInvalidation(update.invalidation, source))
          )
            return listener();
        },
        (sessionId) => {
          if (sessionId !== root.sessionId) return;
          reads.revoke('session');
          preview.value = null;
          dismissStat();
          errorText.value = '所属会话已关闭';
        },
      ),
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
  const mediaUrl = (resource: ResourceRef | null | undefined) => media.dataUrl(root.sessionId, resource) ?? '';
  watch(
    () => (panel.value ? definition.displayResources(panel.value) : []),
    (resources) => {
      void media.replaceCollection(root.sessionId, 'immersive-preview', resources);
    },
  );
  function previewInputKey() {
    if (!snapshot.value) return '';
    return JSON.stringify([joint.currentTargetKey.value, definition.previewInputs(snapshot.value, joint.draftValue.value)]);
  }
  const previewInputSelection = computed(previewInputKey);
  watch([previewInputSelection, snapshot], ([, baseline], [, previousBaseline]) => {
    if (baseline !== previousBaseline && joint.context.value?.handoff === 'save') return;
    reads.revoke('consumer', 'preview');
    reads.schedule('preview', () => {
      void refreshPreview();
    });
  });
  async function refreshPreview(required = false) {
    const baseline = snapshot.value;
    if (!baseline) return;
    const values = deepClone(joint.draftValue.value);
    const original = joint.baselineSnapshot.value!.value;
    const previous = preview.value;
    const saved = joint.context.value?.handoff === 'save' && previous && previous.baseline !== baseline;
    if (
      previous &&
      (saved || previous.baseline === baseline) &&
      stableDeepEqual(definition.previewInputs(previous.baseline, previous.values), definition.previewInputs(baseline, values))
    ) {
      preview.value = { baseline, graph: previous.graph, values };
      return;
    }
    if (!saved && stableDeepEqual(definition.previewInputs(baseline, values), definition.previewInputs(baseline, original))) {
      preview.value = { baseline, graph: baseline, values };
      return;
    }
    await reads.consume('preview', { root: baseline.root, values }, (signal) => queryJointEditPreview({ baseline, values }, signal), {
      ready: (value) => {
        preview.value = { baseline, graph: cloneQuerySnapshot<JointEditSnapshot>(value), values };
      },
      error: (error) => {
        if (required) throw error;
        feedback.error(error, '关联来源读取失败');
      },
    });
  }
  const stopPreview = observeSavedContent(
    (event) => {
      const update = sessionContentUpdate(event, root?.sessionId);
      if (!update) return;
      if (update.manifest.sessionId !== root.sessionId) return;
    },
    (sessionId) => {
      if (sessionId !== root.sessionId) return;
      reads.revoke('session');
      preview.value = null;
      dismissStat();
      errorText.value = '所属会话已关闭';
    },
  );
  function editable(field: ImmersiveField) {
    return !isExternalSource(snapshot.value?.records.find((record) => record.key === field.recordKey)?.source?.source);
  }
  function updateField(field: ImmersiveField, update: SchemaFieldUpdate) {
    return updateFields([{ field, update }]);
  }

  function updateFields(changes: ImmersiveFieldChange[]) {
    if (changes.some((change) => change.field.handoff)) return switchReference(changes).then(() => undefined);
    const before = deepClone(joint.draftValue.value);
    let after = before;
    try {
      for (const { field, update } of changes) {
        const record = snapshot.value!.records.find((record) => record.key === field.recordKey)!;
        after = (definition.updateField ?? updateImmersiveField)(after, record, field, update);
      }
    } catch (error) {
      feedback.error(error);
      return undefined;
    }
    if (Object.keys(after).some((key) => replacesBase(jointValueData(after[key])) && !replacesBase(jointValueData(before[key]))))
      feedback.info('已修改继承列表中的已有项，当前文件改为整体取代基础内容；保存时会将路径写入 mod_info.json 的 replace，可撤销。');
    joint.setDraft(after);
    history.push(before, after);
    return undefined;
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
    if (useProjectSyncStore().isWaiting(root.modRoot)) return;
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
    const keys = selected ?? notices.value.filter((record) => isExternalSource(record.source?.source)).map((record) => record.key);
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
      if (!submitting && (!(await joint.waitForSave()) || (await joint.inputs.commit()) === false)) return undefined;
      if (!active || joint.currentTargetKey.value !== key) return undefined;
      if (!submitting && joint.dirty.value) {
        const choice = await feedback.choose({
          title: '保存并切换引用？',
          content: () =>
            dialogBody(
              '将更新以下引用：',
              ...changes.map(
                ({ field, update }) =>
                  field.schema.label +
                  '：' +
                  String(immersiveFieldValue(joint.draftValue.value, field) ?? '空引用') +
                  (update.kind === 'set' ? ' 改为 ' + String(update.value) : '，移除当前引用') +
                  '。',
              ),
              '当前修改会先保存到：',
              dialogFiles(jointWriteTargets(snapshot.value!, definition.editableRecords(snapshot.value!)).map((target) => target.path)),
              '然后保存新的引用，并载入对应内容。',
            ),
          choices: [{ label: '保存并切换', value: 'save', type: 'primary' }],
          cancelText: '返回编辑',
        });
        if (choice !== 'save' || !active || joint.currentTargetKey.value !== key) return undefined;
        if (!(await joint.saveDraft()) || joint.dirty.value || !active || joint.currentTargetKey.value !== key) return undefined;
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
        return undefined;
      }
      previous = null;
      if (active && joint.currentTargetKey.value === key) {
        dismissStat();
        await joint.refreshTarget(joint.currentTarget.value!);
        return true;
      }
    } catch (error) {
      if (previous && active && joint.currentTargetKey.value === key && !joint.saving.value) joint.setDraft(previous);
      feedback.error(error, '切换关联来源失败');
    } finally {
      referenceChanging.value = false;
    }
    return undefined;
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
    const stop = await listenSavedIdentity(async (event) => {
      const target = joint.currentTarget.value;
      if (
        !target ||
        (event.sessionId !== target.sessionId && !sessionContentUpdate(event, target.sessionId)) ||
        normalizeFsPath(event.modRoot) !== normalizeFsPath(target.modRoot) ||
        !joint.acceptsSaveDelivery(target, event.result.requestId)
      )
        return;
      const changes = event.result.identityChanges.filter(
        (change) =>
          change.before.kind === root.kind &&
          (change.before.id !== change.after.id ||
            normalizeFsPath(change.before.write.path) !== normalizeFsPath(change.after.write.path)) &&
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
      const change = changes[0];
      if (!change) return;
      if (!joint.acceptsSaveDelivery(target, event.result.requestId)) return;
      if (joint.dirty.value) {
        const choice = await feedback.choose({
          title: '跟随' + (change.before.id === target.id ? definition.label : '模块装配') + '改名？',
          content:
            changes
              .map(
                (change) =>
                  `${change.before.id === target.id ? '当前' + definition.label : '当前编辑使用的模块装配'}已由 ${change.before.id} 改为 ${change.after.id}。\n\n原文件：\n${change.before.write.path}\n\n新文件：\n${change.after.write.path}`,
              )
              .join('\n\n') + '\n\n跟随后保留当前草稿、输入和草稿历史。',
          choices: [{ label: '保留编辑并跟随', value: 'follow', type: 'primary' }],
          cancelText: '稍后处理',
        });
        if (!joint.acceptsSaveDelivery(target, event.result.requestId)) return;
        if (choice !== 'follow')
          throw new AppError('联合身份交接尚未确认', { code: 'write.identity_pending', action: 'follow-saved-identity' });
      }
      let captured: JointEditSnapshot | null = null;
      const accepted = await reads.consume(
        'identity',
        { target },
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
      if (!accepted || !captured || !joint.acceptsSaveDelivery(target, event.result.requestId)) return;
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
            requestId: event.result.requestId,
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
    preview.value = null;
    selectionIntent = null;
    stopIdentity?.();
    stopPreview();
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
      content:
        '放弃当前编辑中的未保存修改，并载入以下来源的外部版本：\n\n' +
        jointWriteTargets(snapshot.value!, definition.editableRecords(snapshot.value!))
          .map((target) => target.path)
          .join('\n'),
      actionText: '放弃修改并载入',
      onConfirm: async () => {
        if (!(await joint.waitForSave())) return;
        if (active && joint.currentTargetKey.value === key) {
          dismissStat();
          joint.loadPendingExternal();
        }
      },
      cancelText: '返回编辑',
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
