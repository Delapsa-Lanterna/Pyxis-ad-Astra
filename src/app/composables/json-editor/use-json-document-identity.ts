import { normalizeFsPath } from '@/shared/lib/paths';
import { onScopeDispose, shallowRef, watch, type Ref } from 'vue';
import { listenSavedIdentity, sessionContentUpdate } from '@/orchestrators/project-sync.orchestrator';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import type { EditTargetDraftSession, EditTargetSnapshot } from '@/app/composables/use-edit-target-draft-session';
import type { AppFeedback, EntityKind } from '@/shared/types';
import { AppError } from '@/shared/lib/errors';

export interface JsonDocumentIdentity<TValue, TTarget, TMeta> {
  kind: EntityKind;
  label: string;
  read: (target: TTarget, id: string, signal?: AbortSignal) => Promise<EditTargetSnapshot<TValue, TTarget, TMeta> | null>;
  map: (value: TValue, previousId: string, nextId: string) => TValue;
}
export function useJsonDocumentIdentity<TValue, TTarget extends { sessionId: string; modRoot: string; id?: string }, TMeta>(
  session: Pick<
    EditTargetDraftSession<TValue, TTarget, TMeta>,
    'currentTarget' | 'baselineSnapshot' | 'dirty' | 'adoptIdentity' | 'acceptsSaveDelivery'
  >,
  active: Readonly<Ref<boolean>>,
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
        const previousPaths = session.baselineSnapshot.value!.baseVersions.map((version) => version.path).join('\n');
        const nextPaths = handoff.snapshot.baseVersions.map((version) => version.path).join('\n');
        const choice = await feedback.choose({
          title: '跟随文档改名？',
          content: `这个${identity!.label}已在其他编辑入口保存为 ${handoff.nextId}，原 ID 是 ${handoff.previousId}。\n\n${previousPaths === nextPaths ? nextPaths : '原文件：\n' + previousPaths + '\n\n新文件：\n' + nextPaths}\n\n跟随后保留当前草稿、输入和草稿历史。`,
          choices: [{ label: '保留编辑并跟随', value: 'follow', type: 'primary' }],
          cancelText: '稍后处理',
        });
        if (disposed || pending.value !== handoff || !active.value) return;
        if (choice !== 'follow')
          throw new AppError('文档身份交接尚未确认', { code: 'write.identity_pending', action: 'follow-saved-identity' });
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
      pending.value = null;
    }
  }
  if (identity) {
    void listenSavedIdentity(async (event) => {
      const target = session.currentTarget.value;
      if (
        !target ||
        (target.sessionId !== event.sessionId && !sessionContentUpdate(event, target.sessionId)) ||
        normalizeFsPath(target.modRoot) !== normalizeFsPath(event.modRoot)
      )
        return;
      const change = event.result.identityChanges.find(
        (change) =>
          change.before.kind === identity.kind &&
          change.before.id === target.id &&
          (change.before.id !== change.after.id || normalizeFsPath(change.before.write.path) !== normalizeFsPath(change.after.write.path)),
      );
      if (!change || !session.acceptsSaveDelivery(target, event.result.requestId)) return;
      try {
        if (disposed || !session.acceptsSaveDelivery(target, event.result.requestId)) return;
        await reads.consume('identity', { target }, (signal) => identity.read(target, change.after.id, signal), {
          ready: (snapshot) => {
            if (snapshot)
              pending.value = {
                snapshot: { ...snapshot },
                previousId: change.before.id,
                nextId: change.after.id,
              };
          },
        });
        const handoff = pending.value;
        if (!handoff || disposed) return;
        if (session.dirty.value && active.value) await acceptPending();
        else await adopt(handoff);
      } catch (error) {
        if (!disposed) feedback.error(error, '同步文档重命名失败');
        throw error;
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
