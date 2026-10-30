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
import type { ChooseOptions, ConfirmOptions } from '@/shared/types';
import { recordLogBestEffort } from '@/services/app-log.service';
import { logFields } from '@/shared/lib/log-fields';
import type { FeedbackLevel, FeedbackFileAction, FeedbackFileActions, WindowFeedback } from '@/shared/types';

export type { FeedbackLevel, FeedbackFileAction, FeedbackFileActions } from '@/shared/types';
export function createAppFeedback(
  message: MessageApiInjection,
  dialog: DialogApiInjection,
  fileActions: FeedbackFileActions,
): WindowFeedback {
  const reportedMedia = new WeakSet<MediaReadError>();
  function showToast(level: FeedbackLevel, text: string, reference: FileReference | null = null, code = '') {
    const actions = reference === null ? [] : fileActions(reference, level, code);
    const content = () => renderToastContent(text, reference, actions);
    if (level === 'error') message.error(content, { duration: 0 });
    else if (level === 'warning') message.warning(content);
    else if (level === 'info') message.info(content);
    else message.success(content);
  }
  return {
    fileActions,
    success: (text) => showToast('success', text),
    info: (text) => showToast('info', text),
    warning: (notice) => {
      const reference = extractFileReferenceFromError(notice.diagnostic);
      showToast('warning', notice.userMessage, reference, notice.diagnostic.code);
      recordLogBestEffort({
        level: 'warning',
        code: notice.diagnostic.code,
        message: notice.diagnostic.message,
        path: reference?.path ?? null,
        line: reference?.line ?? null,
        fields: logFields({ column: notice.diagnostic.location?.column }),
      });
    },
    error: (error, contextMessage) => {
      if (error instanceof MediaReadError) {
        if (reportedMedia.has(error)) return;
        reportedMedia.add(error);
      }
      const text = contextMessage ? contextMessage + '：' + formatError(error) : formatError(error);
      const diagnostic = errorDiagnosticOf(error);
      const reference = extractFileReferenceFromError(error);
      showToast('error', text, reference, diagnostic.code);
      for (const diagnostic of error instanceof MediaReadError ? error.failures : [errorDiagnosticOf(error)])
        recordLogBestEffort({
          level: 'error',
          code: diagnostic.code,
          message: diagnostic.message,
          path: diagnostic.location?.path ?? null,
          line: diagnostic.location?.line ?? null,
          fields: logFields({
            ...errorContextOf(error),
            action: errorContextOf(error).action ?? contextMessage,
            column: diagnostic.location?.column,
          }),
        });
    },
    confirmDanger: (options) => showConfirm(dialog, 'error', options),
    confirmWarning: (options) => showConfirm(dialog, 'warning', options),
    choose: (options) => showChoose(dialog, options),
  };
}

function renderToastContent(text: string, reference: FileReference | null, actions: FeedbackFileAction[]): VNode {
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
              h(NButton, { size: 'tiny', type: action.type, secondary: true, onClick: action.run }, { default: () => action.label }),
            ),
        },
      ),
    );
  return h(NSpace, { vertical: true, size: 'small', wrap: false, align: 'start' }, { default: () => rows });
}

function showConfirm(dialog: DialogApiInjection, type: 'error' | 'warning', options: ConfirmOptions) {
  dialog[type]({
    title: options.title,
    content: options.content,
    positiveText: options.actionText,
    negativeText: '取消',
    onPositiveClick: () => options.onConfirm(),
    onNegativeClick: options.onCancel,
    onClose: options.onCancel,
    onMaskClick: options.onCancel,
  });
}

function showChoose(dialog: DialogApiInjection, options: ChooseOptions): Promise<string | null> {
  return new Promise((resolve) => {
    let resolved = false;
    const instance = dialog.create({
      type: 'info',
      title: options.title,
      content: options.content,
      closable: true,
      showIcon: false,
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
                      resolved = true;
                      instance.destroy();
                      resolve(choice.value);
                    },
                  },
                  { default: () => choice.label },
                ),
              ),
              h(
                NButton,
                {
                  size: 'small',
                  onClick: () => {
                    resolved = true;
                    instance.destroy();
                    resolve(null);
                  },
                },
                { default: () => '取消' },
              ),
            ],
          },
        ),
      onClose: () => {
        if (!resolved) resolve(null);
      },
      onMaskClick: () => {
        if (!resolved) {
          resolved = true;
          instance.destroy();
          resolve(null);
        }
      },
    });
  });
}
