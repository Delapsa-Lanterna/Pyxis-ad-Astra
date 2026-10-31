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
  const encoding = await feedback.choose({
    title: '转码为 UTF-8',
    content: '该文件不是有效的 UTF-8。选择其当前编码，解码结果将以 UTF-8 写回且不可逆。',
    choices: [
      { label: 'GBK / GB18030 (简体中文)', value: 'gb18030', type: 'primary' },
      { label: 'Windows-1252 (西文)', value: 'windows-1252' },
    ],
  });
  if (encoding === null || !accepting()) return;
  try {
    await transcodeFileToUtf8(session.sessionId, session.modRoot, reference.path, encoding);
  } catch (error) {
    if (errorCodeOf(error) === 'text.transcode_not_needed') {
      feedback.info('文件已是 UTF-8，可直接打开');
      return;
    }
    feedback.error(error, '转码为 UTF-8 失败');
    return;
  }
  feedback.success('已转码为 UTF-8：' + reference.path);
}
