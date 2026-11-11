import { useTextFileBatch } from '@/app/composables/text-file-editing/use-text-file-batch';
import { onMounted, watch } from 'vue';
import { useCodeFileRequests } from './use-code-file-requests';
import { useCodeAnalysisSync } from './use-code-analysis-sync';
import { useTextFiles } from '@/app/composables/text-file-editing/use-text-files';
import { useJavaEditor } from '@/app/composables/java-analysis/use-java-editor';
import { useJavaActions } from '@/app/composables/java-analysis/use-java-actions';
import { useCodeProject } from './use-code-project';
import { useWindowContext } from '@/windows/window-context.window';
import { useManagedWindowRequests } from '@/app/composables/use-managed-window-requests';
import { useWindowCloseParticipant, useWindowCloseState } from '@/app/composables/use-window-close-state';
import { useAppFeedback } from '@/app/composables/use-app-feedback';

export function useCodeEditorWindow() {
  const context = useWindowContext('code-editor').value;
  const host = useTextFiles(context.identity);
  const project = useCodeProject(async (path, readOnly) => {
    if (readOnly) return analysis.locate({ file: path, version: 1, range: { start: 0, end: 0 } });
    for (const result of await host.openFiles([{ path }])) if (result.diagnostic) feedback.error(result.diagnostic, '打开文件失败');
  });
  const analysis = useJavaEditor(host, context.identity.modRoot, project.analysisRoots);
  useCodeAnalysisSync(analysis.refresh);
  const actions = useJavaActions(host, analysis, useTextFileBatch(host, context.identity).apply);
  const feedback = useAppFeedback();
  const closing = useWindowCloseState();
  const ready = useCodeFileRequests(host, host.ready);
  useManagedWindowRequests(() => ready);
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
  return { ...host, ready, analysis, actions, closing, project };
}
