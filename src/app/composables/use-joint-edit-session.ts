import { computed, onScopeDispose } from 'vue';
import { useEditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { useJointEditActions } from '@/app/composables/use-joint-edit-actions';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { completeSavedWrite } from '@/orchestrators/file-history-write.orchestrator';
import { jointWriteTargets } from '@/domain/joint-edit';
import type { JointEditRoot, JointEditSnapshot, JointValue, JointEditWriteResult } from '@/shared/types';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { queryJointEdit } from '@/services/joint-edit.service';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { subscribeQueryInvalidations } from '@/services/query-cache.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';

export function useJointEditSession() {
  const actions = useJointEditActions();
  const commands = useSaveCommandStore();
  const feedback = useAppFeedback();
  const reads = useQueryReadOwner();
  let releaseHandoff: (() => Promise<void>) | null = null;
  const session = useEditTargetDraftSession<
    Record<string, JointValue>,
    JointEditRoot,
    { snapshot: JointEditSnapshot; receipt: JointEditWriteResult | null }
  >({
    emptyValue: {},
    targetKey: (root) => JSON.stringify(root),
    load: async (root, signal) => {
      const snapshot = cloneQuerySnapshot<JointEditSnapshot>(await queryJointEdit(root, signal));
      return {
        target: snapshot.root,
        value: Object.fromEntries(snapshot.records.map((record) => [record.key, record.value])),
        baseVersions: snapshot.baseVersions,
        meta: { snapshot, receipt: null },
      };
    },
    save: async (root, values) => {
      const baseline = session.baselineSnapshot.value!;
      const result = await actions.save(
        { baseline: baseline.meta.snapshot, values },
        JSON.stringify(root),
        (release) => (releaseHandoff = release),
      );
      if (!result) return;
      const snapshot = result.refreshedEntity;
      return {
        target: snapshot.root,
        value: Object.fromEntries(snapshot.records.map((record) => [record.key, record.value])),
        baseVersions: result.baseVersions,
        meta: { snapshot, receipt: result },
        commitId: result.commitId,
      };
    },
    afterSaved: async (snapshot) => {
      await releaseHandoff?.();
      releaseHandoff = null;
      if (snapshot.meta.receipt)
        await completeSavedWrite({
          label: '联合保存',
          modRoot: snapshot.target.modRoot,
          sessionId: snapshot.target.sessionId,
          result: snapshot.meta.receipt,
        });
    },
  });
  const unregister = commands.registerSaveSession({
    targetKey: session.currentTargetKey,
    modRoot: computed(() => session.currentTarget.value?.modRoot ?? null),
    saving: session.saving,
    pendingSynchronization: session.hasPendingSynchronization,
    waitForSave: session.waitForSave,
    editing: {
      label: '联合编辑器',
      targets: computed(() => (session.baselineSnapshot.value ? jointWriteTargets(session.baselineSnapshot.value.meta.snapshot) : [])),
      dirty: session.dirty,
      commitInputs: () => session.inputs.commit(),
      save: async () => {
        const snapshot = await session.saveDraft();
        return { saved: Boolean(snapshot), receipt: snapshot?.meta.receipt ?? null };
      },
    },
  });
  const stopInvalidation = subscribeQueryInvalidations((event) => {
    const root = session.currentTarget.value;
    if (!root || event.sessionId !== root.sessionId || event.scope === 'session') return;
    if (event.invalidation?.paths.length) void session.refreshTarget(root).catch((error) => feedback.error(error, '刷新联合编辑失败'));
  });
  async function open(root: JointEditRoot) {
    let opened = false;
    await reads.consume('open', root, (signal) => actions.open(root, signal), {
      ready: (snapshot) => {
        if (!snapshot) return;
        session.loadBaseForTarget({
          target: snapshot.root,
          value: Object.fromEntries(snapshot.records.map((record) => [record.key, record.value])),
          baseVersions: snapshot.baseVersions,
          meta: { snapshot, receipt: null },
        });
        opened = true;
      },
    });
    return opened;
  }
  onScopeDispose(() => {
    stopInvalidation();
    unregister();
    session.dispose();
    void releaseHandoff?.().catch((error) => feedback.error(error, '释放联合编辑交接失败'));
    releaseHandoff = null;
  });
  return { ...session, open, handoffLocked: computed(() => commands.isEditTargetLocked(session.currentTargetKey.value)) };
}
