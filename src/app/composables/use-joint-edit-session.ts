import { computed, onScopeDispose } from 'vue';
import { useEditTargetDraftSession, type EditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { useJointEditActions } from '@/app/composables/use-joint-edit-actions';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { completeSavedWrite, listenProjectSessionInvalidated } from '@/orchestrators/project-sync.orchestrator';
import { jointWriteTargets, rebaseJointDraft, type JointIdentitySnapshot } from '@/domain/joint-edit';
import type { JointEditRoot, JointEditSnapshot, JointValue, JointEditWriteResult } from '@/shared/types';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { queryJointEdit } from '@/services/joint-edit.service';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { subscribeQueryInvalidations } from '@/services/query-cache.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';

import { normalizeFsPath } from '@/shared/lib/paths';

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
      const snapshot = result.refreshedEntity;
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
    afterSaved: async (snapshot) => {
      if (snapshot.meta.receipt && snapshot.meta.previous)
        await options.afterBaseline?.(snapshot.meta.snapshot, snapshot.meta.receipt, snapshot.meta.previous);
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
      targets: computed(() =>
        session.baselineSnapshot.value
          ? jointWriteTargets(session.baselineSnapshot.value.meta.snapshot, editableKeys(session.baselineSnapshot.value.meta.snapshot))
          : [],
      ),
      dirty: session.dirty,
      draftSession: session,
      save: async () => {
        const snapshot = await session.saveDraft();
        return { saved: Boolean(snapshot), receipt: snapshot?.meta.receipt ?? null };
      },
    },
  });
  const stopInvalidation = subscribeQueryInvalidations((event) => {
    const root = session.currentTarget.value;
    if (root && event.sessionId === root.sessionId && event.scope === 'session') session.clearTarget();
  });
  let released = false;
  let stopProjection: (() => void) | null = null;
  void listenProjectSessionInvalidated(async (event) => {
    const root = session.currentTarget.value;
    if (!root || event.manifest.sessionId !== root.sessionId || normalizeFsPath(event.manifest.modRoot) !== normalizeFsPath(root.modRoot))
      return;
    if (event.invalidation.paths.length) {
      if (options.onProjection) await options.onProjection(root);
      else await session.refreshTarget(root);
    }
  })
    .then((stop) => {
      if (released) stop();
      else stopProjection = stop;
    })
    .catch((error) => feedback.error(error, '监听联合编辑更新失败'));
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
    released = true;
    stopProjection?.();
    stopInvalidation();
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
