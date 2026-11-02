import type { AppFeedback } from '@/shared/types';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useFieldInputs, type FieldInputs } from '@/shared/runtime/field-inputs';

export function useFieldInputActions(inputs: FieldInputs | null = useFieldInputs(), feedback: AppFeedback = useAppFeedback()) {
  function commitBefore(action: () => void) {
    const pending = inputs?.commit();
    if (!pending) {
      action();
      return;
    }
    const targetKey = inputs!.targetKey.value;
    return pending
      .then((accepted) => {
        if (accepted && targetKey === inputs!.targetKey.value) action();
      })
      .catch((error: unknown) => feedback.error(error));
  }

  function confirmDiscard(action: () => void, dirty: boolean, targetKey: () => string | null, paths: string[] = []) {
    if (!dirty) {
      action();
      return;
    }
    const capturedKey = targetKey();
    feedback.confirmWarning({
      title: '载入外部版本？',
      content:
        (paths.length > 1 ? '放弃当前文档的未保存修改，载入以下文件的外部版本：' : '放弃这份文件的未保存修改，载入外部版本继续编辑。') +
        '\n\n' +
        paths.join('\n'),
      actionText: '放弃修改并载入',
      onConfirm: () => {
        if (targetKey() === capturedKey) action();
      },
      cancelText: '返回编辑',
    });
  }

  return { commitBefore, confirmDiscard };
}
