import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { JointEditRoot, JointEditSnapshot, JointValue } from '@/shared/types';
import { useJointEditSession } from './use-joint-edit-session';
import { useSnapshotHistory } from './use-snapshot-history';
import { useQueryReadOwner } from './use-query-read-owner';
import { useAppFeedback } from './use-app-feedback';
import { useResourceMediaRegistry } from './use-resource-media-registry';
import { useSettingsStore } from '@/stores/settings.store';
import { immersiveSourceRecords } from '@/domain/immersive/source-records';
import { immersiveDefinition } from '@/domain/immersive/editor-definition';
import { changeWeaponSpecClass } from '@/domain/editors/spec-construction';
import { updateImmersiveField, type ImmersiveField, type ImmersiveFieldChange } from '@/domain/immersive/fields';
import type { SchemaFieldUpdate } from '@/domain/schema/schema.types';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import { jointObject, mapJointDraftIdentity, rebaseJointDraft } from '@/domain/joint-edit';
import { queryJointEdit, queryJointEditRow, queryJointEditProjection } from '@/services/joint-edit.service';
import { querySourceOptionCatalog } from '@/services/source-options.service';
import { subscribeQueryInvalidations, hasSourceInvalidation } from '@/services/query-cache.service';
import { retargetImmersiveWindow, openImmersiveProjectile } from '@/orchestrators/immersive-editor.orchestrator';
import { listenEntityIdentityApplied } from '@/orchestrators/entity-events.orchestrator';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { deepClone } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { formatError, warningNotice } from '@/shared/lib/errors';
import { normalizeFsPath, joinRootRelativePath, isAbsoluteFsPath, pathBelongsToRoot } from '@/shared/lib/paths';

export function useImmersiveEditorViewModel(root: JointEditRoot & { kind: 'ship' | 'weapon' }) {
  const definition = immersiveDefinition(root.kind);
  const feedback = useAppFeedback();
  const settings = useSettingsStore();
  const reads = useQueryReadOwner();
  let windowCommit = -1;
  let active = true;
  let selectionIntent: object | null = null;
  let stopIdentity: (() => void) | null = null;
  const selectedStatId = ref<string | null>(null);
  const errorText = ref('');
  const projection = shallowRef<JointEditSnapshot | null>(null);
  const joint = useJointEditSession({
    editableRecords: definition.editableRecords,
    afterBaseline: async (snapshot, receipt, previous) => {
      if (receipt.commitId <= windowCommit) return;
      await retargetImmersiveWindow(snapshot);
      history.rebase((value) => mapJointDraftIdentity(value, previous, snapshot, receipt.identityChanges, receipt.keyMap));
      windowCommit = receipt.commitId;
    },
  });
  const history = useSnapshotHistory<Record<string, JointValue>>(joint.context, settings.historyLimit);
  const snapshot = computed(() => joint.baselineSnapshot.value?.meta.snapshot ?? null);
  const panel = computed(() => (snapshot.value ? definition.project(snapshot.value, joint.draftValue.value, projection.value) : null));
  const notices = computed(() =>
    snapshot.value
      ? Object.values(immersiveSourceRecords(snapshot.value)).filter(
          (record) => record.source?.source === 'core' || record.value.state === 'missing',
        )
      : [],
  );
  const runtimeContext = computed<SchemaRuntimeContext>(() => ({
    sessionId: joint.currentTarget.value?.sessionId ?? root.sessionId,
    modRoot: root.modRoot,
    sourceContextKey: joint.currentTargetKey.value ?? '',
    querySourceOptions: (source, signal) => querySourceOptionCatalog(root.sessionId, source, signal),
    subscribeSourceOptionInvalidation: (source, _resources, listener) =>
      subscribeQueryInvalidations((event) => {
        if (event.sessionId === root.sessionId && hasSourceInvalidation(event, source)) listener();
      }),
  }));
  const media = useResourceMediaRegistry({
    surface: '沉浸式贴图',
    onError: (error) => feedback.error(error),
    onFailures: (resources) =>
      feedback.warning(
        warningNotice(
          `贴图读取失败：${resources.map((resource) => resource.relPath).join('、')}`,
          'resource.read_failed',
          `Resource read failed: count=${resources.length}; surface=immersive`,
        ),
      ),
  });
  const mediaUrl = (resource: import('@/shared/types').ResourceRef | null | undefined) => media.dataUrl(root.sessionId, resource) ?? '';
  const sprite = computed(() => (panel.value?.kind === 'ship' ? mediaUrl(panel.value.sprite) : ''));
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
    const original = Object.fromEntries(baseline.records.map((record) => [record.key, record.value]));
    if (!force && stableDeepEqual(definition.references(baseline, joint.draftValue.value), definition.references(baseline, original))) {
      projection.value = baseline;
      return;
    }
    projection.value = null;
    await reads.consume(
      'projection',
      { root: baseline.root, values: joint.draftValue.value },
      (signal) => queryJointEditProjection({ baseline, values: joint.draftValue.value }, signal),
      {
        ready: (value) => {
          projection.value = cloneQuerySnapshot<JointEditSnapshot>(value);
        },
        error: (error) => feedback.error(error, '关联来源读取失败'),
      },
    );
  }
  const stopProjection = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== root.sessionId) return;
    if (event.scope === 'session') {
      reads.revoke('session');
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
    const before = deepClone(joint.draftValue.value);
    let after = before;
    for (const { field, update } of changes) {
      const record = snapshot.value!.records.find((record) => record.key === field.recordKey)!;
      after = updateImmersiveField(after, record, field, update);
      if (
        root.kind === 'weapon' &&
        record.key === snapshot.value!.bindings.spec &&
        field.schema.key === 'specClass' &&
        update.kind === 'set' &&
        (update.value === 'projectile' || update.value === 'beam')
      ) {
        after = {
          ...after,
          [record.key]: { state: 'present', value: changeWeaponSpecClass(jointObject(after[record.key]), update.value) },
        };
      }
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
  async function createOverrides() {
    const target = joint.currentTarget.value;
    const admitted = joint.inputs.captureContext();
    const keys = notices.value.filter((record) => record.source?.source === 'core').map((record) => record.key);
    try {
      const records = snapshot.value!;
      const spec = immersiveSourceRecords(records).spec;
      let corrected: Record<string, JointValue> | undefined;
      if (root.kind === 'weapon' && jointObject(spec.value).specClass === 'pulse' && keys.includes(spec.key)) {
        const choice = await feedback.choose({
          title: '选择覆盖的武器分支',
          content: 'pulse 在原版中无法正常处理，选择合法分支并补齐必读字段后建立当前 Mod 覆盖。',
          choices: [
            { label: '弹丸 projectile', value: 'projectile', type: 'primary' },
            { label: '光束 beam', value: 'beam' },
          ],
        });
        if (choice !== 'projectile' && choice !== 'beam') return;
        if (!active || !admitted() || joint.currentTarget.value !== target) return;
        corrected = { [spec.key]: { state: 'present', value: changeWeaponSpecClass(jointObject(spec.value), choice) } };
      }
      if (!active || !admitted() || joint.currentTarget.value !== target) return;
      await joint.createOverrides(keys, corrected);
    } catch (error) {
      feedback.error(error);
    }
  }
  async function openProjectile() {
    const target = joint.currentTarget.value;
    const admitted = joint.inputs.captureContext();
    try {
      if ((await joint.inputs.commit()) === false) return;
      if (!active || !admitted() || joint.currentTarget.value !== target) return;
      await openImmersiveProjectile(snapshot.value!, joint.draftValue.value, settings.settingsSnapshot());
    } catch (error) {
      feedback.error(error, '打开弹体编辑器失败');
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
  async function initialize() {
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
        (change) => change.before.kind === root.kind && change.before.id === target.id && change.after.id !== target.id,
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
            : queryJointEdit({ ...target, id: change.after.id }, signal),
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
      await joint.loadTarget(root);
    } catch (error) {
      errorText.value = formatError(error);
    }
  }
  onScopeDispose(() => {
    active = false;
    selectionIntent = null;
    stopIdentity?.();
    stopProjection();
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
    joint,
    snapshot,
    panel,
    notices,
    runtimeContext,
    sprite,
    mediaUrl,
    errorText,
    selectedStatId,
    history,
    editable,
    updateField,
    updateFields,
    toggleStat,
    dismissStat,
    save,
    createOverrides,
    openProjectile,
    undo,
    redo,
    initialize,
    loadExternal,
  };
}
