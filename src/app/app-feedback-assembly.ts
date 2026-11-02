import { ref } from 'vue';
import { dialogBody, dialogFiles, dialogSelect } from '@/shared/ui/dialog-content';
import { useSaveCommandStore } from '@/stores/save-command.store';
import type { DialogApiInjection } from 'naive-ui/es/dialog/src/DialogProvider';
import type { MessageApiInjection } from 'naive-ui/es/message/src/MessageProvider';
import { createAppFeedback, type FeedbackFileAction } from '@/app/app-feedback';
import type { AppFeedback, ToastDurations } from '@/shared/types';
import { errorCodeOf, type FileReference } from '@/shared/lib/errors';
import type { FeedbackFileTarget, WindowFeedback } from '@/shared/types';
import { closestRootForPath, pathBelongsToRoot } from '@/shared/lib/paths';
import { useProjectStore } from '@/stores/project.store';
import { managedWindowContext } from '@/windows/window-context.window';
import { openFileEditorWindow } from '@/windows/file-editor.window';
import { transcodeFileToUtf8 } from '@/services/files.service';

export function createWindowFeedback(
  message: MessageApiInjection,
  dialog: DialogApiInjection,
  toastDurations: () => ToastDurations,
  accepting = () => true,
): WindowFeedback {
  const feedback = createAppFeedback(
    message,
    dialog,
    (reference, level, code) => {
      const session = reference.target ?? resolveSessionForPath(reference.path);
      if (session === null) return [];
      const actions: FeedbackFileAction[] = [
        {
          label: '打开文件',
          type: level === 'info' ? 'default' : level,
          run: async () => {
            if (!accepting()) return;
            try {
              await openFileEditorWindow({
                ...session,
                path: reference.path,
                line: reference.line,
                column: reference.column,
                title: '文件编辑器',
              });
            } catch (error) {
              feedback.error(error, '打开文件失败');
            }
          },
        },
      ];
      if (code === 'text.invalid_utf8')
        actions.push({
          label: '转码为 UTF-8',
          type: 'warning',
          run: () => {
            if (accepting()) return useSaveCommandStore().trackCloseAction(transcodeReference(feedback, reference, session, accepting));
            return undefined;
          },
        });
      return actions;
    },
    toastDurations,
  );
  return feedback;
}

function resolveSessionForPath(path: string): Omit<FeedbackFileTarget, 'path'> | null {
  const project = useProjectStore();
  const modRoot = closestRootForPath(project.manifests.keys(), path);
  const sessionId = modRoot === null ? null : project.getSessionId(modRoot);
  if (modRoot !== null && sessionId !== null) return { mode: 'session', modRoot, sessionId };
  const identity = managedWindowContext.value?.identity;
  if (identity && 'sessionId' in identity && pathBelongsToRoot(path, identity.modRoot))
    return { mode: 'session', modRoot: identity.modRoot, sessionId: identity.sessionId };
  if (identity?.type === 'recovery' && identity.modRoot && pathBelongsToRoot(path, identity.modRoot))
    return { mode: 'recovery', modRoot: identity.modRoot, sessionId: null };
  return null;
}

async function transcodeReference(
  feedback: AppFeedback,
  reference: FileReference,
  session: Omit<FeedbackFileTarget, 'path'>,
  accepting: () => boolean,
): Promise<void> {
  const encoding = ref('gb18030');
  const choice = await feedback.choose({
    title: '选择文件的原编码',
    content: () =>
      dialogBody(
        '这个文件无法按 UTF-8 读取：',
        dialogFiles([reference.path]),
        dialogSelect('文件原编码', encoding, [
          { label: 'GBK / GB18030', value: 'gb18030' },
          { label: 'Windows-1252', value: 'windows-1252' },
        ]),
        `按 ${encoding.value === 'gb18030' ? 'GBK / GB18030' : 'Windows-1252'} 读取这个文件，并写回 UTF-8。`,
        '转换记录进入文件历史，可通过对应文件操作撤销。',
      ),
    choices: [{ label: '转换并写回', value: 'convert', type: 'warning' }],
    cancelText: '返回',
  });
  if (choice === null || !accepting()) return;
  try {
    await transcodeFileToUtf8(session.sessionId, session.modRoot, reference.path, encoding.value);
  } catch (error) {
    if (errorCodeOf(error) === 'text.transcode_not_needed') {
      feedback.info('文件已经是 UTF-8，可以直接打开。');
      return;
    }
    feedback.error(error, '转换文件编码失败');
    return;
  }
  feedback.success('已转码为 UTF-8：' + reference.path);
}
