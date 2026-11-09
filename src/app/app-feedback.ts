import { h, type VNode } from 'vue';
import { NButton } from 'naive-ui/es/button';
import type { DialogApiInjection } from 'naive-ui/es/dialog/src/DialogProvider';
import type { MessageApiInjection } from 'naive-ui/es/message/src/MessageProvider';
import { NSpace } from 'naive-ui/es/space';
import { NText } from 'naive-ui/es/typography';
import {
  extractFileReferenceFromError,
  fileReferenceLocationSuffix,
  formatError,
  errorDiagnosticOf,
  errorContextOf,
  MediaReadError,
  type FileReference,
} from '@/shared/lib/errors';
import { isReadInvalidated } from '@/shared/runtime/read-request';
import type { ChooseOptions, ConfirmOptions, ToastDurations, FeedbackContext } from '@/shared/types';
import { recordLogBestEffort } from '@/services/app-log.service';
import { logFields, logIdentity } from '@/shared/lib/log-fields';
import type { FeedbackLevel, FeedbackFileAction, FeedbackFileActions, WindowFeedback } from '@/shared/types';

export type { FeedbackLevel, FeedbackFileAction, FeedbackFileActions } from '@/shared/types';
export function createAppFeedback(
  message: MessageApiInjection,
  dialog: DialogApiInjection,
  fileActions: FeedbackFileActions,
  toastDurations: () => ToastDurations,
  toastVisible: (level: FeedbackLevel, paths: readonly string[]) => boolean | Promise<boolean> = () => true,
): WindowFeedback {
  const loggedMedia = new WeakSet<MediaReadError>();
  const displayedMedia = new WeakSet<MediaReadError>();
  function showToast(
    level: FeedbackLevel,
    text: string,
    reference: FileReference | null = null,
    code = '',
    context?: FeedbackContext,
    media?: MediaReadError,
  ) {
    const paths = [
      ...(context?.paths ?? []),
      ...(media?.failures.flatMap((failure) => (failure.location?.path ? [failure.location.path] : [])) ?? []),
      ...(reference ? [reference.path] : []),
    ];
    const visible = toastVisible(level, paths);
    const actions = reference === null ? [] : fileActions(reference, level, code);
    const seconds = toastDurations()[level];
    const present = (show: boolean) => {
      if (!show || (media && displayedMedia.has(media))) return;
      if (media) displayedMedia.add(media);
      // The countdown animation owns expiry so hover pauses the same clock shown by the bar.
      const instance = message[level](
        () =>
          h('div', { class: 'app-toast-content' }, [
            renderToastContent(text, reference, actions, runFileAction),
            seconds > 0
              ? h('span', {
                  class: 'app-toast-countdown',
                  'aria-hidden': true,
                  style: { '--app-toast-duration': seconds + 's', '--app-toast-color': `var(--n-icon-color-${level})` },
                  onAnimationend: () => instance.destroy(),
                })
              : null,
          ]),
        { duration: 0 },
      );
    };
    if (visible instanceof Promise)
      void visible.then(present).catch((error: unknown) => {
        if (isReadInvalidated(error)) return;
        const diagnostic = errorDiagnosticOf(error);
        recordLogBestEffort({
          level: 'error',
          code: diagnostic.code,
          message: diagnostic.message,
          path: diagnostic.location?.path ?? null,
          line: diagnostic.location?.line ?? null,
          fields: logFields({ action: 'toast-visibility', column: diagnostic.location?.column }),
        });
      });
    else present(visible);
  }
  async function runFileAction(action: FeedbackFileAction) {
    try {
      await action.run();
    } catch (error) {
      feedback.error(error, '文件操作失败');
    }
  }
  const feedback: WindowFeedback = {
    fileActions,
    success: (text, context) => showToast('success', text, null, '', context),
    info: (text, context) => showToast('info', text, null, '', context),
    warning: (notice, context) => {
      const reference = extractFileReferenceFromError(notice.diagnostic);
      showToast('warning', notice.userMessage, reference, notice.diagnostic.code, context);
      recordLogBestEffort({
        level: 'warning',
        code: notice.diagnostic.code,
        message: notice.diagnostic.message,
        path: reference?.path ?? null,
        line: reference?.line ?? null,
        fields: logFields({ ...logIdentity(notice.diagnostic.fileTarget), column: notice.diagnostic.location?.column }),
      });
    },
    error: (error, contextMessage, context) => {
      const text = contextMessage ? contextMessage + '：' + formatError(error) : formatError(error);
      const diagnostic = errorDiagnosticOf(error);
      const reference = extractFileReferenceFromError(error);
      showToast('error', text, reference, diagnostic.code, context, error instanceof MediaReadError ? error : undefined);
      if (error instanceof MediaReadError) {
        if (loggedMedia.has(error)) return;
        loggedMedia.add(error);
      }
      for (const failure of error instanceof MediaReadError ? error.failures : [error]) {
        const diagnostic = errorDiagnosticOf(failure);
        recordLogBestEffort({
          level: 'error',
          code: diagnostic.code,
          message: diagnostic.message,
          path: diagnostic.location?.path ?? null,
          line: diagnostic.location?.line ?? null,
          fields: logFields({
            ...errorContextOf(error),
            ...errorContextOf(failure),
            ...logIdentity(diagnostic.fileTarget),
            action: errorContextOf(error).action ?? contextMessage,
            column: diagnostic.location?.column,
          }),
        });
      }
    },
    confirmDanger: (options) => showConfirm(dialog, 'error', options),
    confirmWarning: (options) => showConfirm(dialog, 'warning', options),
    choose: (options) => showChoose(dialog, options),
  };
  return feedback;
}

function renderToastContent(
  text: string,
  reference: FileReference | null,
  actions: FeedbackFileAction[],
  run: (action: FeedbackFileAction) => Promise<void>,
): VNode {
  const rows: VNode[] = [h('span', { class: 'app-toast-text' }, text)];
  if (reference !== null) {
    const locationText = reference.line
      ? reference.path + ' (' + fileReferenceLocationSuffix(reference.line, reference.column) + ')'
      : reference.path;
    rows.push(h(NText, { depth: 3, class: 'app-toast-text' }, { default: () => locationText }));
  }
  if (actions.length)
    rows.push(
      h(
        NSpace,
        { size: 'small', wrap: false, align: 'center' },
        {
          default: () =>
            actions.map((action) =>
              h(
                NButton,
                { size: 'tiny', type: action.type, secondary: true, onClick: () => void run(action) },
                { default: () => action.label },
              ),
            ),
        },
      ),
    );
  return h(NSpace, { vertical: true, size: 'small', wrap: false, align: 'start' }, { default: () => rows });
}

function showConfirm(dialog: DialogApiInjection, type: 'error' | 'warning', options: ConfirmOptions) {
  dialog[type]({
    class: 'app-dialog',
    showIcon: true,
    title: options.title,
    content: () => h('div', { class: 'dialog-text' }, [typeof options.content === 'function' ? options.content() : options.content]),
    positiveText: options.actionText,
    negativeText: options.cancelText ?? '取消',
    onPositiveClick: () => options.onConfirm(),
    onNegativeClick: options.onCancel,
    onClose: options.onCancel,
    onEsc: options.onCancel,
    onMaskClick: options.onCancel,
  });
}

function showChoose(dialog: DialogApiInjection, options: ChooseOptions): Promise<string | null> {
  const type =
    options.type ??
    (options.choices.some((choice) => choice.type === 'error')
      ? 'error'
      : options.choices.some((choice) => choice.type === 'warning')
        ? 'warning'
        : 'info');
  return new Promise((resolve) => {
    const cancel = () => resolve(null);
    const instance = dialog.create({
      class: 'app-dialog',
      type,
      title: options.title,
      content: () => h('div', { class: 'dialog-text' }, [typeof options.content === 'function' ? options.content() : options.content]),
      closable: true,
      showIcon: true,
      action: () =>
        h(
          NSpace,
          { justify: 'end', size: 'small' },
          {
            default: () => [
              ...options.choices.map((choice) =>
                h(
                  NButton,
                  {
                    type: choice.type ?? 'default',
                    size: 'small',
                    onClick: () => {
                      instance.destroy();
                      resolve(choice.value);
                    },
                  },
                  { default: () => choice.label },
                ),
              ),
              options.cancelText !== null &&
                h(
                  NButton,
                  {
                    size: 'small',
                    onClick: () => {
                      instance.destroy();
                      resolve(null);
                    },
                  },
                  { default: () => options.cancelText ?? '取消' },
                ),
            ],
          },
        ),
      onClose: cancel,
      onEsc: () => {
        cancel();
        instance.destroy();
      },
      onMaskClick: () => {
        cancel();
        instance.destroy();
      },
    });
  });
}
