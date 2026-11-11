import { onMounted, watch } from 'vue';
import { useCodeEditor } from './use-code-editor';
import { useCodeAnalysis } from './use-code-analysis';
import { useCodeActions } from './use-code-actions';
import { useCodeProject } from './use-code-project';
import { useWindowContext } from '@/windows/window-context.window';
import { useManagedWindowRequests } from '@/app/composables/use-managed-window-requests';
import { useWindowCloseParticipant, useWindowCloseState } from '@/app/composables/use-window-close-state';
import { useAppFeedback } from '@/app/composables/use-app-feedback';

export function useCodeEditorWindow() {
  const context = useWindowContext('code-editor').value;
  const host = useCodeEditor(context.identity);
  const project = useCodeProject(host, (file) => analysis.locate({ file, version: 1, range: { start: 0, end: 0 } }));
  const analysis = useCodeAnalysis(host, context.identity.modRoot, project.analysisRoots);
  const actions = useCodeActions(host, analysis, context.identity);
  const feedback = useAppFeedback();
  const closing = useWindowCloseState();
  useManagedWindowRequests(() => host.ready);
  let requested = false;
  watch(
    () => host.documents.some((file) => !file.readOnly && analysis.supports(file)),
    (needed) => {
      if (needed && !requested) {
        requested = true;
        if (!analysis.isStarted()) void analysis.start();
      }
    },
    { immediate: true },
  );
  const participant = useWindowCloseParticipant({
    dirty: host.dirty,
    settle: async () => {
      await project.settle();
      await host.settle();
      await analysis.settle();
    },
    title: '关闭代码编辑器？',
    content: '这些文件有未保存修改，关闭后将丢弃修改。',
  });
  onMounted(() => {
    void participant.install().catch((error) => feedback.error(error, '代码编辑器操作失败'));
  });
  return { ...host, analysis, actions, closing, project };
}
