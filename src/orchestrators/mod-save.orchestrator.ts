import { dialogBody, dialogFiles, dialogGroup } from '@/shared/ui/dialog-content';
import type { AppFeedback } from '@/shared/types';
import type {
  ModSaveTarget,
  WindowSavePreparation,
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
import { normalizeFsPath } from '@/shared/lib/paths';
import { stableStringify } from '@/shared/lib/stable-compare';

export function createModSaveCoordinator(feedback: AppFeedback, closing: () => boolean) {
  const saveCommands = useSaveCommandStore(),
    project = useProjectStore(),
    workspace = useWorkspaceStore();
  const label = currentWindowLabel(),
    pendingBatches = new Map<string, Promise<WindowSaveReply>>();
  let batchTail: Promise<unknown> = Promise.resolve(),
    disposed = false;
  const captures = new Map<string, () => boolean>();
  const participants = (target: ModSaveTarget, paths: string[] | null = null) =>
    saveCommands
      .participantsForSession(target.sessionId, target.modRoot)
      .filter(
        ({ participant }) =>
          !paths ||
          participant.editing!.targets.value.some((target) => paths.some((path) => normalizeFsPath(path) === normalizeFsPath(target.path))),
      );
  const failed = (entry: Pick<WindowSaveItem, 'label' | 'paths'>, error: unknown): WindowSaveItem => ({
    ...entry,
    status: 'failed',
    diagnostic: errorDiagnosticOf(error),
  });
  async function handleLocalSaveRequest(request: WindowSaveRequest): Promise<WindowSaveReply> {
    const { target, action } = request;
    if (action.kind === 'list' || action.kind === 'capture' || action.kind === 'finish') {
      if (action.kind === 'finish') captures.clear();
      if (action.kind === 'capture') {
        captures.clear();
        for (const { participant } of participants(target, action.paths)) {
          if ((await participant.editing!.draftSession.inputs.commit()) === false)
            throw new AppError('输入提交已取消，请继续编辑后重试', { action: 'save-mod' });
        }
      }
      return {
        kind: 'participants',
        participants: participants(target, action.kind === 'list' ? null : action.paths)
          .filter(
            ({ participant }) =>
              participant.editing!.dirty.value ||
              participant.editing!.draftSession.inputs.dirty.value ||
              participant.saving.value ||
              saveCommands.isSaveQueued(participant),
          )
          .map(({ id, participant }) => {
            const captureKey = action.kind === 'capture' ? crypto.randomUUID() : undefined;
            if (captureKey) {
              const editing = participant.editing!,
                captured = editing.captureContent?.();
              const value = captured ? undefined : stableStringify(editing.draftSession.draftValue.value);
              const content = captured ?? (() => stableStringify(editing.draftSession.draftValue.value) === value),
                input = editing.draftSession.inputs.captureContext();
              captures.set(captureKey, () => content() && input() && !editing.draftSession.inputs.dirty.value);
            }
            return {
              id,
              targetKey: participant.targetKey.value,
              label: participant.editing!.label,
              paths: participant.editing!.targets.value.map((own) => own.path),
              captureKey,
            };
          }),
      };
    }
    if (action.kind !== 'save') return enqueueBatch(target, action.kind === 'prepare' ? action.preparation : undefined);
    const entry = action.participant;
    const item: WindowSaveItem = { label: entry.label, paths: entry.paths, status: 'cancelled', diagnostic: null };
    const participant = participants(target).find(({ id }) => id === entry.id)?.participant;
    const accepts = () =>
      !disposed &&
      !closing() &&
      participant &&
      participant.targetKey.value === entry.targetKey &&
      participants(target).some((own) => own.id === entry.id && own.participant === participant);
    try {
      if (!accepts() || !(await saveCommands.waitForParticipant(participant!)) || !accepts())
        throw new AppError('保存目标已变化或保存尚未完成', { action: 'save-mod' });
      if (entry.captureKey) {
        const current = captures.get(entry.captureKey);
        captures.delete(entry.captureKey);
        if (!current?.()) throw new AppError('确认期间文件已变化，请重新确认保存操作', { action: 'save-mod' });
      }
      const committed = await participant!.editing!.draftSession.inputs.commit();
      if (committed !== false && accepts()) {
        item.status = participant!.editing!.dirty.value ? (await saveCommands.requestSave(participant!)).status : 'noop';
      }
    } catch (error) {
      return { kind: 'results', items: [failed(entry, error)] };
    }
    return { kind: 'results', items: [item] };
  }
  async function saveParticipants(target: ModSaveTarget, preparation?: WindowSavePreparation): Promise<WindowSaveReply> {
    const confirm = preparation !== undefined;
    const items: WindowSaveItem[] = [],
      captured: { receiver: string; participant: WindowSaveParticipant }[] = [];
    const receivers = await queryEditTargetOwners([{ ...target, path: target.modRoot }]);
    async function finishPreparation(check: boolean) {
      if (!confirm) return;
      const current = new Set(receivers);
      try {
        for (const receiver of await queryEditTargetOwners([{ ...target, path: target.modRoot }])) current.add(receiver);
      } catch (error) {
        items.push(failed({ label: '构建保存确认', paths: [target.modRoot] }, error));
      }
      for (const receiver of current) {
        try {
          const request: WindowSaveRequest = { target, action: { kind: 'finish', paths: preparation!.paths } };
          const reply = receiver === label ? await handleLocalSaveRequest(request) : await requestWindowSave(receiver, request);
          if (check && reply.kind === 'participants')
            items.push(
              ...reply.participants.map((entry) =>
                failed(entry, new AppError('保存期间出现未保存修改，请重新确认操作', { action: 'save-mod' })),
              ),
            );
        } catch (error) {
          items.push(failed({ label: receiver, paths: [target.modRoot] }, error));
        }
      }
    }
    receivers.sort((a, b) => Number(a === 'main') - Number(b === 'main') || a.localeCompare(b));
    for (const receiver of receivers) {
      try {
        const request: WindowSaveRequest = {
          target,
          action: preparation ? { kind: 'capture', paths: preparation.paths } : { kind: 'list' },
        };
        const reply = receiver === label ? await handleLocalSaveRequest(request) : await requestWindowSave(receiver, request);
        if (reply.kind === 'participants') captured.push(...reply.participants.map((participant) => ({ receiver, participant })));
      } catch (error) {
        items.push(failed({ label: receiver, paths: [target.modRoot] }, error));
      }
    }
    if (confirm && items.length) {
      await finishPreparation(false);
      return { kind: 'results', items };
    }
    if (confirm && captured.length) {
      const choice = await feedback.choose({
        title: preparation?.purpose === 'sync' ? '保存构建配置后同步？' : '保存并构建？',
        content: [...new Set(captured.flatMap((item) => item.participant.paths))].join('\n'),
        choices: [{ label: preparation?.purpose === 'sync' ? '保存并同步' : '保存并构建', value: 'save', type: 'primary' }],
        cancelText: '继续编辑',
      });
      if (!choice) {
        await finishPreparation(false);
        return { kind: 'results', items: captured.map(({ participant }) => ({ ...participant, status: 'cancelled', diagnostic: null })) };
      }
    }
    for (const { receiver, participant } of captured) {
      try {
        if (project.getManifest(target.modRoot)?.sessionId !== target.sessionId)
          throw new AppError('保存项目已关闭或重新打开', { action: 'save-mod' });
        const request: WindowSaveRequest = { target, action: { kind: 'save', participant } };
        const reply = receiver === label ? await handleLocalSaveRequest(request) : await requestWindowSave(receiver, request);
        if (reply.kind === 'results') items.push(...reply.items);
      } catch (error) {
        items.push(failed(participant, error));
      }
    }
    await finishPreparation(items.every((item) => item.status === 'saved' || item.status === 'noop'));
    return { kind: 'results', items };
  }
  function enqueueBatch(target: ModSaveTarget, preparation?: WindowSavePreparation): Promise<WindowSaveReply> {
    const key = JSON.stringify([target, preparation]);
    const pending = pendingBatches.get(key);
    if (pending) return pending;
    const result = batchTail.then(() => saveParticipants(target, preparation)).finally(() => pendingBatches.delete(key));
    pendingBatches.set(key, result);
    batchTail = result.catch(() => undefined);
    return result;
  }
  async function handleSaveMessage(message: WindowSaveMessage) {
    let result: WindowSaveReply | null = null,
      diagnostic = null;
    try {
      if (disposed || closing()) throw new AppError('窗口正在关闭', { action: 'save-mod' });
      result = await handleLocalSaveRequest(message.request);
    } catch (error) {
      diagnostic = errorDiagnosticOf(error);
    }
    await replyWindowSave(message, result, diagnostic);
  }
  const ready = registerWindowSaveReceiver((message) => {
    void handleSaveMessage(message).catch((error) => {
      if (!disposed) feedback.error(error, '交付 Mod 保存结果失败');
    });
  });
  const pendingRequests = new Map<string, Promise<void>>();
  async function requestBatchSave(target: ModSaveTarget) {
    try {
      await ready;
      const reply = await requestWindowSave('main', { target, action: { kind: 'batch' } });
      if (disposed || reply.kind !== 'results') return;
      const saved = reply.items.filter((item) => item.status === 'saved').length;
      const cancelled = reply.items.filter((item) => item.status === 'cancelled').length;
      const failures = reply.items.filter((item) => item.status === 'failed').length;
      const context = { paths: [target.modRoot, ...reply.items.flatMap((item) => item.paths)] };
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
      else if (saved) feedback.success('已保存 ' + saved + ' 项。', context);
      else feedback.info('当前 Mod 没有需要保存的修改。', context);
    } catch (error) {
      if (!disposed) feedback.error(error, '保存当前 Mod 失败', { paths: [target.modRoot] });
    }
  }
  function saveCurrentMod(): Promise<void> {
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
      pending = pendingRequests.get(key);
    if (pending) return pending;
    const result = requestBatchSave(target).finally(() => pendingRequests.delete(key));
    pendingRequests.set(key, result);
    return result;
  }
  function dispose() {
    disposed = true;
    captures.clear();
    void ready.then(unregisterWindowSaveReceiver).catch((error) => feedback.error(error, '释放 Mod 保存登记失败'));
  }
  return { saveCurrentMod, dispose, ready };
}
