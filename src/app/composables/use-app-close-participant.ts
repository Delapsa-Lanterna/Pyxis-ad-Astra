import { pauseQueryReads } from '@/app/composables/use-query-read-owner';
import { inject, provide, nextTick, watch, type InjectionKey } from 'vue';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { currentWindowLabel, listenCurrentWindowCloseRequest } from '@/windows/current.window';
import { listenAppEvent, type UnlistenFn } from '@/shared/runtime/event.runtime';
import { WINDOW_EVENTS } from '@/windows/window.events';
import { updateNativeWindowStatus } from '@/services/window.service';
import { settleWindowRequests } from '@/windows/window-context.window';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import { AppError, errorDiagnosticOf } from '@/shared/lib/errors';
import { useWindowCloseState, useWindowCloseRequest, type WindowCloseParticipantOptions } from './use-window-close-state';
import type { ClosePhase, ErrorDiagnostic, WindowCloseIntent } from '@/shared/types';
import { settleProjectSaves } from '@/orchestrators/project-sync.orchestrator';
interface AppCloseActions {
  replyClose: (operationId: number, phase: ClosePhase, accepted: boolean, diagnostic: ErrorDiagnostic | null) => Promise<void>;
  readyClose: () => Promise<void>;
  prepareDisplay: () => () => Promise<void>;
  acceptReleasedSessions: (sessionIds: string[]) => void;
  flushPerformance: () => Promise<void>;
  flushSettings: () => Promise<void>;
}
const appCloseActionsKey: InjectionKey<AppCloseActions> = Symbol('app-close-actions');

export function provideAppCloseActions(actions: AppCloseActions) {
  provide(appCloseActionsKey, actions);
}

export function useAppCloseParticipant(options: WindowCloseParticipantOptions) {
  const feedback = useAppFeedback(),
    commands = useSaveCommandStore(),
    closing = useWindowCloseState()!;
  const actions = inject(appCloseActionsKey)!;
  const requestClose = useWindowCloseRequest();
  const unlisteners: UnlistenFn[] = [];
  let disposed = false,
    operationId = 0;
  let focusedElement: Element | null = null;
  const parentOperationIds: number[] = [];
  let pendingStages = Promise.resolve();
  let pending: Promise<boolean> | null = null;
  let acceptsPreparedContent = () => true;
  const resumeCallbacks: Array<() => Promise<void>> = [];
  async function handle(intent: WindowCloseIntent) {
    if (intent.phase === 'hold') {
      if (operationId) parentOperationIds.push(operationId);
      operationId = intent.operationId;
      focusedElement = document.activeElement;
      closing.value = true;
    }
    if (intent.operationId !== operationId) {
      await actions.replyClose(intent.operationId, intent.phase, true, null);
      return;
    }
    let accepted = true;
    let diagnostic = null;
    try {
      switch (intent.phase) {
        case 'hold':
          break;
        case 'settle':
          await settleWindowRequests();
          await options.settle?.();
          await commands.settleCloseActions();
          if (intent.scope.kind === 'window' || currentWindowLabel() === 'main') {
            await settleProjectSaves(intent.scope, feedback);
            while (commands.hasPendingSave()) {
              if (!(await commands.waitForSaves()) && commands.hasPendingSave())
                throw new AppError('保存尚未完成', { action: 'close-prepare' });
            }
          }
          break;
        case 'prepare':
          resumeCallbacks.push(pauseQueryReads(), actions.prepareDisplay(), ...commands.closePreparations.map((prepare) => prepare()));
          commands.closePrepared = true;
          await nextTick();
          acceptsPreparedContent = commands.captureCloseState();
          break;
        case 'confirm':
          if (!acceptsPreparedContent()) throw new AppError('关闭准备内容已变化', { action: 'close-confirm' });
          if (options.dirtyForScope?.(intent.scope) ?? options.dirty.value) {
            if (intent.onlyIfClean) {
              accepted = false;
              break;
            }
            accepted =
              (await feedback.choose({
                choices: [{ label: '放弃修改并关闭', value: 'discard', type: 'warning' }],
                content: options.content,
                title: options.title,
              })) === 'discard';
          }
          accepted = accepted && acceptsPreparedContent();
          break;
        case 'flush':
          if (currentWindowLabel() === 'main') await actions.flushSettings();
          else await actions.flushPerformance();
          break;
        case 'resume': {
          actions.acceptReleasedSessions(intent.releasedSessions);
          await nextTick();
          commands.closePrepared = false;
          operationId = parentOperationIds.pop() ?? 0;
          closing.value = operationId !== 0;
          let releaseError: unknown;
          for (const release of resumeCallbacks.splice(0)) {
            try {
              await release();
            } catch (error) {
              releaseError ??= error;
            }
          }
          await nextTick();
          if (focusedElement instanceof HTMLElement && focusedElement.isConnected) focusedElement.focus();
          if (releaseError) throw releaseError;
          break;
        }
      }
    } catch (error) {
      accepted = false;
      diagnostic = errorDiagnosticOf(error);
    }
    if (!disposed) await actions.replyClose(intent.operationId, intent.phase, accepted, diagnostic);
  }
  async function install() {
    const stop = await listenCurrentWindowCloseRequest((event) => {
      event.preventDefault();
      void requestWindowClose();
    });
    if (disposed) {
      stop();
      return;
    }
    unlisteners.push(stop);
    const unlisten = await listenAppEvent<WindowCloseIntent>(
      WINDOW_EVENTS.windowCloseIntent,
      (intent) => {
        pendingStages = pendingStages
          .then(() => handle(intent))
          .catch((error) => recordWindowEventHandlerError(error, WINDOW_EVENTS.windowCloseIntent));
        return pendingStages;
      },
      recordWindowEventHandlerError,
      currentWindowLabel(),
    );
    if (disposed) {
      unlisten();
      return;
    }
    unlisteners.push(
      unlisten,
      watch(
        () => [options.dirty.value, commands.hasPendingSave()] as const,
        ([dirty, saving]) => {
          void updateNativeWindowStatus({ dirty, saving }).catch((error) => feedback.error(error));
        },
        { immediate: true, flush: 'sync' },
      ),
    );
    await actions.readyClose();
  }
  function requestWindowClose(): Promise<boolean> {
    if (pending) return pending;
    pending = requestClose({ kind: 'window' })
      .then((result) => {
        if (result.diagnostic) feedback.error(result.diagnostic, '关闭失败');
        return result.status === 'closed';
      })
      .catch((error) => {
        feedback.error(error, '关闭失败');
        return false;
      })
      .finally(() => {
        pending = null;
      });
    return pending;
  }
  function dispose() {
    disposed = true;
    unlisteners.splice(0).forEach((stop) => stop());
  }
  return { install, requestClose: requestWindowClose, dispose };
}
