import { onMounted } from 'vue';
import { useCodeEditor } from './use-code-editor';
import { useWindowContext } from '@/windows/window-context.window';
import { useManagedWindowRequests } from '@/app/composables/use-managed-window-requests';
import { useWindowCloseParticipant, useWindowCloseState } from '@/app/composables/use-window-close-state';
import { useAppFeedback } from '@/app/composables/use-app-feedback';

export function useCodeEditorWindow() {
  const context = useWindowContext('code-editor').value;
  const host = useCodeEditor(context.identity);
  const feedback = useAppFeedback();
  const closing = useWindowCloseState();
  useManagedWindowRequests(() => host.ready);
  const participant = useWindowCloseParticipant({
    dirty: host.dirty,
    settle: host.settle,
    title: '关闭代码编辑器？',
    content: '这些文件有未保存修改，关闭后将丢弃修改。',
  });
  onMounted(() => {
    void participant.install().catch((error) => feedback.error(error, '代码编辑器操作失败'));
  });
  return { ...host, closing };
}
