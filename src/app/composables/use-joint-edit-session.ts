import { computed, onScopeDispose } from 'vue';
import { useEditTargetDraftSession, type EditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { useJointEditActions } from '@/app/composables/use-joint-edit-actions';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { completeSavedWrite, subscribeProjectChanges, projectChangeSessionId } from '@/orchestrators/project-sync.orchestrator';
import { jointWriteTargets, rebaseJointDraft, type JointIdentitySnapshot } from '@/domain/joint-edit';
import type { JointEditRoot, JointEditSnapshot, JointValue, JointEditWriteResult, WriteContent } from '@/shared/types';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { queryJointEdit } from '@/services/joint-edit.service';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';

import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';

import { normalizeFsPath } from '@/shared/lib/paths';
import { stableDeepEqual } from '@/shared/lib/stable-compare';

export function useJointEditSession(
  options: {
    editableRecords?: (snapshot: JointEditSnapshot) => string[];
    afterBaseline?: (snapshot: JointEditSnapshot, receipt: JointEditWriteResult, previous: JointIdentitySnapshot) => Promise<void>;
    readSnapshot?: (root: JointEditRoot, signal?: AbortSignal) => Promise<import('@/shared/types').DeepReadonly<JointEditSnapshot>>;
    onProjection?: (root: JointEditRoot) => Promise<void>;
  } = {},
) {
  const actions = useJointEditActions();
  const commands = useSaveCommandStore();
  const feedback = useAppFeedback();
  const reads = useQueryReadOwner();
  let releaseHandoff: (() => Promise<void>) | null = null;
  let overrideIntent: string[] = [];
  let overrideValues: Record<string, JointValue> | undefined;
  const editableKeys = (snapshot: JointEditSnapshot) => options.editableRecords?.(snapshot) ?? snapshot.records.map((record) => record.key);
  const valuesOf = (snapshot: JointEditSnapshot) =>
    Object.fromEntries(
      snapshot.records.filter((record) => editableKeys(snapshot).includes(record.key)).map((record) => [record.key, record.value]),
    );
  type Meta = { snapshot: JointEditSnapshot; receipt: JointEditWriteResult | null; previous: JointIdentitySnapshot | null };
  const session: EditTargetDraftSession<Record<string, JointValue>, JointEditRoot, Meta> = useEditTargetDraftSession<
    Record<string, JointValue>,
    JointEditRoot,
    Meta
  >({
    emptyValue: {},
    targetKey: (root) => JSON.stringify(root),
    load: async (root, signal) => {
      const snapshot = cloneQuerySnapshot<JointEditSnapshot>(await (options.readSnapshot ?? queryJointEdit)(root, signal));
      return {
        target: snapshot.root,
        value: valuesOf(snapshot),
        baseVersions: snapshot.baseVersions,
        meta: { snapshot, receipt: null, previous: null },
      };
    },
    save: async (root, values) => {
      const baseline = session.baselineSnapshot.value!;
      const result = await actions.save(
        { baseline: baseline.meta.snapshot, values: overrideValues ? { ...values, ...overrideValues } : values },
        JSON.stringify(root),
        (release) => (releaseHandoff = release),
        overrideIntent,
      );
      if (!result) return;
      const snapshot = result.content?.value;
      return {
        target: snapshot.root,
        value: valuesOf(snapshot),
        baseVersions: result.baseVersions,
        meta: {
          snapshot,
          receipt: result,
          previous: {
            bindings: baseline.meta.snapshot.bindings,
            records: baseline.meta.snapshot.records.map(({ key, target }) => ({ key, target })),
          },
        },
        commitId: result.commitId,
      };
    },
    mapSavedDraft: (draft, before, after, submitted) =>
      rebaseJointDraft(
        draft,
        before.meta.snapshot,
        after.meta.snapshot,
        after.meta.receipt?.identityChanges ?? [],
        after.meta.receipt?.keyMap ?? [],
        submitted,
      ),
    acceptSaved: async (snapshot) => {
      if (snapshot.meta.receipt && snapshot.meta.previous)
        await options.afterBaseline?.(snapshot.meta.snapshot, snapshot.meta.receipt, snapshot.meta.previous);
      await releaseHandoff?.();
      releaseHandoff = null;
    },
    synchronizeSaved: async (snapshot) => {
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
      targets: computed(() =>
        session.baselineSnapshot.value
          ? jointWriteTargets(session.baselineSnapshot.value.meta.snapshot, editableKeys(session.baselineSnapshot.value.meta.snapshot))
          : [],
      ),
      dirty: session.dirty,
      draftSession: session,
      save: async () => {
        const snapshot = await session.saveDraft();
        return snapshot ? { status: 'saved', receipt: snapshot.meta.receipt! } : { status: 'cancelled' };
      },
    },
  });
  const stopChanges = subscribeProjectChanges((change) => {
    const root = session.currentTarget.value;
    if (!root || projectChangeSessionId(change) !== root.sessionId) return;
    if (change.kind === 'closed') {
      session.clearTarget();
      return;
    }
    if (normalizeFsPath(change.projection.manifest.modRoot) !== normalizeFsPath(root.modRoot)) return;
    const receipt = change.kind === 'commit' ? change.event.result : null;
    if (receipt && !session.isTargetCommitCurrent(root, receipt.commitId)) return;
    const content = receipt?.content as WriteContent<JointEditSnapshot> | null;
    if (content?.target.kind === 'joint' && stableDeepEqual(content.target.root, root)) {
      const snapshot = cloneQuerySnapshot(content.value);
      session.applyExternalForTarget({
        target: snapshot.root,
        value: valuesOf(snapshot),
        baseVersions: receipt!.baseVersions,
        commitId: receipt!.commitId,
        meta: { snapshot, receipt: null, previous: null },
      });
    } else if (change.projection.invalidation.paths.length || change.projection.invalidation.session) {
      void (options.onProjection ? options.onProjection(root) : session.refreshTarget(root)).catch((error) =>
        feedback.error(error, '读取联合编辑更新失败'),
      );
    }
  });
  async function open(root: JointEditRoot) {
    let opened = false;
    await reads.consume('open', root, (signal) => actions.open(root, signal), {
      ready: (snapshot) => {
        if (!snapshot) return;
        session.loadBaseForTarget({
          target: snapshot.root,
          value: valuesOf(snapshot),
          baseVersions: snapshot.baseVersions,
          meta: { snapshot, receipt: null, previous: null },
        });
        opened = true;
      },
    });
    return opened;
  }
  onScopeDispose(() => {
    stopChanges();
    unregister();
    session.dispose();
    void releaseHandoff?.().catch((error) => feedback.error(error, '释放联合编辑交接失败'));
    releaseHandoff = null;
  });
  function createOverrides(keys: string[], values?: Record<string, JointValue>) {
    if (session.saving.value) return session.saveDraft();
    overrideIntent = [...keys];
    overrideValues = values;
    return session.saveDraft().finally(() => {
      overrideIntent = [];
      overrideValues = undefined;
    });
  }
  return { ...session, open, createOverrides, handoffLocked: computed(() => commands.isEditTargetLocked(session.currentTargetKey.value)) };
}
