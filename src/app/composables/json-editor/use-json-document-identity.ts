import { normalizeFsPath } from '@/shared/lib/paths';
import { onScopeDispose, shallowRef, watch, type Ref } from 'vue';
import { listenEntityIdentityApplied } from '@/orchestrators/project-sync.orchestrator';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import type { EditTargetDraftSession, EditTargetSnapshot } from '@/app/composables/use-edit-target-draft-session';
import type { useSnapshotHistory } from '@/app/composables/use-snapshot-history';
import type { AppFeedback, EntityKind } from '@/shared/types';

export interface JsonDocumentIdentity<TValue, TTarget, TMeta> {
  kind: EntityKind;
  read: (target: TTarget, id: string, signal?: AbortSignal) => Promise<EditTargetSnapshot<TValue, TTarget, TMeta> | null>;
  map: (value: TValue, previousId: string, nextId: string) => TValue;
}
export function useJsonDocumentIdentity<TValue, TTarget extends { sessionId: string; modRoot: string; id?: string }, TMeta>(
  session: EditTargetDraftSession<TValue, TTarget, TMeta>,
  active: Readonly<Ref<boolean>>,
  history: ReturnType<typeof useSnapshotHistory<TValue>>,
  identity: JsonDocumentIdentity<TValue, TTarget, TMeta> | undefined,
  feedback: AppFeedback,
) {
  const pending = shallowRef<{
    snapshot: EditTargetSnapshot<TValue, TTarget, TMeta>;
    previousId: string;
    nextId: string;
  } | null>(null);
  const reads = useQueryReadOwner();
  let disposed = false;
  let asking = false;
  let stop: (() => void) | null = null;
  async function acceptPending() {
    const handoff = pending.value;
    if (!handoff || asking || !active.value) return;
    asking = true;
    try {
      if (session.dirty.value) {
        const choice = await feedback.choose({
          title: '跟随实体重命名？',
          content: '保留当前草稿、活动输入和历史，并接纳新的正式身份。',
          choices: [{ label: '保留编辑并跟随', value: 'follow', type: 'primary' }],
        });
        if (choice !== 'follow' || disposed || pending.value !== handoff || !active.value) return;
      }
      await adopt(handoff);
    } finally {
      asking = false;
    }
  }
  async function adopt(handoff: NonNullable<typeof pending.value>) {
    const target = session.currentTarget.value!;
    const map = (value: TValue) => identity!.map(value, handoff.previousId, handoff.nextId);
    if (session.adoptIdentity(target, handoff.snapshot, session.dirty.value ? map : () => handoff.snapshot.value, 'identity')) {
      history.rebase(map);
      pending.value = null;
    }
  }
  if (identity) {
    void listenEntityIdentityApplied(async (event) => {
      const target = session.currentTarget.value;
      if (!target || target.sessionId !== event.sessionId || normalizeFsPath(target.modRoot) !== normalizeFsPath(event.modRoot)) return;
      const change = event.result.identityChanges.find(
        (change) => change.before.kind === identity.kind && change.before.id === target.id && change.before.id !== change.after.id,
      );
      if (!change || !session.isTargetCommitCurrent(target, event.result.commitId)) return;
      try {
        if (session.saving.value && !(await session.waitForSave())) return;
        if (disposed || !session.isTargetCommitCurrent(target, event.result.commitId)) return;
        await reads.consume(
          'identity',
          { target, commitId: event.result.commitId },
          (signal) => identity.read(target, change.after.id, signal),
          {
            ready: (snapshot) => {
              if (snapshot)
                pending.value = {
                  snapshot: { ...snapshot, commitId: event.result.commitId },
                  previousId: change.before.id,
                  nextId: change.after.id,
                };
            },
          },
        );
        const handoff = pending.value;
        if (!handoff || disposed) return;
        if (session.dirty.value) await acceptPending();
        else await adopt(handoff);
      } catch (error) {
        if (!disposed) feedback.error(error, '同步文档重命名失败');
      }
    })
      .then((listener) => {
        if (disposed) listener();
        else stop = listener;
      })
      .catch((error: unknown) => {
        if (!disposed) feedback.error(error, '监听 JSON 文档身份失败');
      });
  }
  watch(active, () => {
    void acceptPending().catch((error: unknown) => feedback.error(error, '跟随文档重命名失败'));
  });
  onScopeDispose(() => {
    disposed = true;
    stop?.();
    pending.value = null;
  });
  return { pending };
}
