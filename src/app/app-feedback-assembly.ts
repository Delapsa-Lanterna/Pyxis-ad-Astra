import { useSaveCommandStore } from '@/stores/save-command.store';
import type { DialogApiInjection } from 'naive-ui/es/dialog/src/DialogProvider';
import type { MessageApiInjection } from 'naive-ui/es/message/src/MessageProvider';
import { createAppFeedback, type FeedbackFileAction, type FeedbackLevel } from '@/app/app-feedback';
import type { AppFeedback, FileWindowLocation, WriteResult } from '@/shared/types';
import type { FileReference } from '@/shared/lib/errors';
import { closestRootForPath, pathBelongsToRoot } from '@/shared/lib/paths';
import { useProjectStore } from '@/stores/project.store';
import { managedWindowContext } from '@/windows/window-context.window';
import { openFileEditorWindow } from '@/windows/file-editor.window';
import { transcodeFileToUtf8 } from '@/services/files.service';
import { publishCommittedWrite } from '@/orchestrators/project-sync.orchestrator';

interface FeedbackFileSession {
  modRoot: string;
  sessionId: string;
}
interface FileActionContext {
  contextLabel: string;
  contextSeverity: NonNullable<FileWindowLocation['contextSeverity']>;
  buttonType: FeedbackFileAction['type'];
}
const FILE_ACTION_CONTEXT: Record<FeedbackLevel, FileActionContext> = {
  success: { contextLabel: '信息', contextSeverity: 'info', buttonType: 'success' },
  info: { contextLabel: '信息', contextSeverity: 'info', buttonType: 'default' },
  warning: { contextLabel: '警告', contextSeverity: 'warning', buttonType: 'warning' },
  error: { contextLabel: '错误', contextSeverity: 'error', buttonType: 'error' },
};

export function createWindowFeedback(message: MessageApiInjection, dialog: DialogApiInjection, accepting = () => true): AppFeedback {
  const feedback = createAppFeedback(message, dialog, (reference, level, code) => {
    const session = resolveSessionForPath(reference.path);
    if (session === null) return [];
    const context = FILE_ACTION_CONTEXT[level];
    const actions: FeedbackFileAction[] = [
      {
        label: '打开文件',
        type: context.buttonType,
        run: async () => {
          if (!accepting()) return;
          try {
            await openFileEditorWindow({
              ...session,
              path: reference.path,
              line: reference.line,
              column: reference.column,
              title: '文件编辑器',
              contextLabel: context.contextLabel,
              contextSeverity: context.contextSeverity,
              message: reference.message,
            });
          } catch (error) {
            feedback.error(error, '打开文件失败');
          }
        },
      },
    ];
    if (level === 'error' && code === 'text.invalid_utf8')
      actions.push({
        label: '转码为 UTF-8',
        type: 'warning',
        run: () => {
          if (accepting()) return useSaveCommandStore().trackCloseAction(transcodeReference(feedback, reference, session));
        },
      });
    return actions;
  });
  return feedback;
}

function resolveSessionForPath(path: string): FeedbackFileSession | null {
  const project = useProjectStore();
  const modRoot = closestRootForPath(project.manifests.keys(), path);
  const sessionId = modRoot === null ? null : project.getSessionId(modRoot);
  if (modRoot !== null && sessionId !== null) return { modRoot, sessionId };
  const identity = managedWindowContext.value?.identity;
  if (identity && 'sessionId' in identity && pathBelongsToRoot(path, identity.modRoot))
    return { modRoot: identity.modRoot, sessionId: identity.sessionId };
  return null;
}

async function transcodeReference(feedback: AppFeedback, reference: FileReference, session: FeedbackFileSession): Promise<void> {
  const encoding = await feedback.choose({
    title: '转码为 UTF-8',
    content: '该文件不是有效的 UTF-8。选择其当前编码，解码结果将以 UTF-8 写回且不可逆。',
    choices: [
      { label: 'GBK / GB18030（简体中文）', value: 'gb18030', type: 'primary' },
      { label: 'Windows-1252（西文）', value: 'windows-1252' },
    ],
  });
  if (encoding === null) return;
  let result: WriteResult;
  try {
    result = await transcodeFileToUtf8(session.sessionId, session.modRoot, reference.path, encoding);
  } catch (error) {
    feedback.error(error, '转码为 UTF-8 失败');
    return;
  }
  try {
    await publishCommittedWrite(session.modRoot, result, session.sessionId);
  } catch (error) {
    feedback.error(error, '已转码为 UTF-8，项目同步失败');
    return;
  }
  feedback.success('已转码为 UTF-8：' + reference.path);
}
