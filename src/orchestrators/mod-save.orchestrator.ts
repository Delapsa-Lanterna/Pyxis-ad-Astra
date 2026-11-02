import { dialogBody, dialogFiles, dialogGroup } from '@/shared/ui/dialog-content';
import type { AppFeedback } from '@/shared/types';
import type {
  ModSaveTarget,
  WindowSaveItem,
  WindowSaveMessage,
  WindowSaveParticipant,
  WindowSaveReply,
  WindowSaveRequest,
} from '@/shared/types';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { currentWindowLabel } from '@/windows/current.window';
import { managedWindowContext } from '@/windows/window-context.window';
import {
  queryEditTargetOwners,
  registerWindowSaveReceiver,
  unregisterWindowSaveReceiver,
  requestWindowSave,
  replyWindowSave,
} from '@/services/window.service';
import { AppError, errorDiagnosticOf, formatError } from '@/shared/lib/errors';

export function createModSaveCoordinator(feedback: AppFeedback, closing: () => boolean) {
  const commands = useSaveCommandStore(),
    project = useProjectStore(),
    workspace = useWorkspaceStore();
  const label = currentWindowLabel(),
    batches = new Map<string, Promise<WindowSaveReply>>();
  let tail: Promise<unknown> = Promise.resolve(),
    disposed = false;
  const participants = (target: ModSaveTarget) => commands.participantsForSession(target.sessionId, target.modRoot);
  const failed = (entry: Pick<WindowSaveItem, 'label' | 'paths'>, error: unknown): WindowSaveItem => ({
    ...entry,
    status: 'failed',
    diagnostic: errorDiagnosticOf(error),
  });
  async function local(request: WindowSaveRequest): Promise<WindowSaveReply> {
    const { target, action } = request;
    if (action.kind === 'list')
      return {
        kind: 'participants',
        participants: participants(target)
          .filter(
            ({ handle }) =>
              handle.editing!.dirty.value ||
              handle.editing!.draftSession.inputs.dirty.value ||
              handle.saving.value ||
              commands.isSaveQueued(handle),
          )
          .map(({ id, handle }) => ({
            id,
            targetKey: handle.targetKey.value,
            label: handle.editing!.label,
            paths: handle.editing!.targets.value.map((own) => own.path),
          })),
      };
    if (action.kind !== 'save') return batch(target);
    const entry = action.participant;
    const item: WindowSaveItem = { label: entry.label, paths: entry.paths, status: 'cancelled', diagnostic: null };
    const handle = participants(target).find(({ id }) => id === entry.id)?.handle;
    const accepts = () =>
      !disposed &&
      !closing() &&
      handle &&
      handle.targetKey.value === entry.targetKey &&
      participants(target).some((own) => own.id === entry.id && own.handle === handle);
    try {
      if (!accepts() || !(await commands.waitForSession(handle!)) || !accepts())
        throw new AppError('保存目标已变化或保存尚未完成', { action: 'save-mod' });
      const committed = await handle!.editing!.draftSession.inputs.commit();
      if (committed !== false && accepts()) {
        item.status = handle!.editing!.dirty.value ? (await commands.requestSave(handle!)).status : 'noop';
      }
    } catch (error) {
      return { kind: 'results', items: [failed(entry, error)] };
    }
    return { kind: 'results', items: [item] };
  }
  async function run(target: ModSaveTarget): Promise<WindowSaveReply> {
    const items: WindowSaveItem[] = [],
      captured: { receiver: string; participant: WindowSaveParticipant }[] = [];
    const receivers = await queryEditTargetOwners([{ ...target, path: target.modRoot }]);
    receivers.sort((a, b) => Number(a === 'main') - Number(b === 'main') || a.localeCompare(b));
    for (const receiver of receivers) {
      try {
        const request: WindowSaveRequest = { target, action: { kind: 'list' } };
        const reply = receiver === label ? await local(request) : await requestWindowSave(receiver, request);
        if (reply.kind === 'participants') captured.push(...reply.participants.map((participant) => ({ receiver, participant })));
      } catch (error) {
        items.push(failed({ label: receiver, paths: [target.modRoot] }, error));
      }
    }
    for (const { receiver, participant } of captured) {
      try {
        if (project.getManifest(target.modRoot)?.sessionId !== target.sessionId)
          throw new AppError('保存项目已关闭或重新打开', { action: 'save-mod' });
        const request: WindowSaveRequest = { target, action: { kind: 'save', participant } };
        const reply = receiver === label ? await local(request) : await requestWindowSave(receiver, request);
        if (reply.kind === 'results') items.push(...reply.items);
      } catch (error) {
        items.push(failed(participant, error));
      }
    }
    return { kind: 'results', items };
  }
  function batch(target: ModSaveTarget): Promise<WindowSaveReply> {
    const key = JSON.stringify(target);
    const pending = batches.get(key);
    if (pending) return pending;
    const result = tail.then(() => run(target)).finally(() => batches.delete(key));
    batches.set(key, result);
    tail = result.catch(() => undefined);
    return result;
  }
  async function receive(message: WindowSaveMessage) {
    let result: WindowSaveReply | null = null,
      diagnostic = null;
    try {
      if (disposed || closing()) throw new AppError('窗口正在关闭', { action: 'save-mod' });
      result = await local(message.request);
    } catch (error) {
      diagnostic = errorDiagnosticOf(error);
    }
    await replyWindowSave(message, result, diagnostic);
  }
  const ready = registerWindowSaveReceiver((message) => {
    void receive(message).catch((error) => {
      if (!disposed) feedback.error(error, '交付 Mod 保存结果失败');
    });
  });
  const triggers = new Map<string, Promise<void>>();
  async function execute(target: ModSaveTarget) {
    try {
      await ready;
      const reply = await requestWindowSave('main', { target, action: { kind: 'batch' } });
      if (disposed || reply.kind !== 'results') return;
      const saved = reply.items.filter((item) => item.status === 'saved').length;
      const cancelled = reply.items.filter((item) => item.status === 'cancelled').length;
      const failures = reply.items.filter((item) => item.status === 'failed').length;
      if (cancelled + failures)
        await feedback.choose({
          title: 'Mod 保存结果',
          type: 'warning',
          content: () =>
            dialogBody(
              '已保存 ' + saved + ' 项，取消 ' + cancelled + ' 项，失败 ' + failures + ' 项。',
              ...reply.items
                .filter((item) => item.status === 'failed' || item.status === 'cancelled')
                .map((item) =>
                  dialogGroup(
                    (item.status === 'failed' ? '失败：' : '已取消：') + item.label,
                    dialogFiles(item.paths),
                    item.diagnostic ? formatError(item.diagnostic) : '保存已取消。',
                  ),
                ),
            ),
          choices: [],
          cancelText: '关闭',
        });
      else if (saved) feedback.success('已保存 ' + saved + ' 项。');
      else feedback.info('当前 Mod 没有需要保存的修改。');
    } catch (error) {
      if (!disposed) feedback.error(error, '保存当前 Mod 失败');
    }
  }
  function save(): Promise<void> {
    const identity = managedWindowContext.value?.identity;
    const manifest = label === 'main' ? workspace.activeManifest : null;
    const target = manifest
      ? { sessionId: manifest.sessionId, modRoot: manifest.modRoot }
      : identity && 'sessionId' in identity
        ? { sessionId: identity.sessionId, modRoot: identity.modRoot }
        : null;
    if (closing()) return Promise.resolve();
    if (!target) {
      feedback.info('请先选择或打开 Mod');
      return Promise.resolve();
    }
    const key = JSON.stringify(target),
      pending = triggers.get(key);
    if (pending) return pending;
    const result = execute(target).finally(() => triggers.delete(key));
    triggers.set(key, result);
    return result;
  }
  function dispose() {
    disposed = true;
    void ready.then(unregisterWindowSaveReceiver).catch((error) => feedback.error(error, '释放 Mod 保存登记失败'));
  }
  return { save, dispose, ready };
}
