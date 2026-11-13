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
import { useJavaProject } from '@/app/composables/java-project/use-java-project';
import { requestWindowSave } from '@/services/window.service';
import { withFileTargets } from '@/orchestrators/window-identity.orchestrator';
import { beginSavedWrite, settleSavedContent } from '@/orchestrators/project-sync.orchestrator';
import { deployJavaArtifact } from '@/services/java-project.service';
import { AppError } from '@/shared/lib/errors';

export function useCodeEditorWindow() {
  const context = useWindowContext('code-editor').value;
  const host = useTextFiles(context.identity);
  const project = useCodeProject(async (path, readOnly) => {
    if (readOnly) return analysis.locate({ file: path, version: 1, range: { start: 0, end: 0 } });
    for (const result of await host.openFiles([{ path }])) if (result.diagnostic) feedback.error(result.diagnostic, '打开文件失败');
  });
  const analysis = useJavaEditor(host, context.identity.modRoot, project.analysisRoots);
  const engineering = useJavaProject({
    changed: async () => {
      await project.refreshSources();
      if (analysis.isStarted()) await analysis.reconfigure();
    },
    open: async (path, line) => host.openFiles([{ path, line }]),
    prepare: async (operation) => {
      const reply = await requestWindowSave('main', {
        target: context.identity,
        action: {
          kind: 'prepare',
          preparation: {
            purpose: operation.kind === 'build' ? 'build' : 'sync',
            paths: operation.kind === 'build' ? null : (engineering.snapshot.value?.buildFiles ?? []),
          },
        },
      });
      if (reply.kind !== 'results') throw new AppError('保存回执类型错误', { action: 'java-build' });
      const failed = reply.items.find((item) => item.status === 'failed');
      if (failed) throw new AppError(failed.diagnostic?.message ?? '构建前保存失败', { cause: failed.diagnostic });
      if (!reply.items.every((item) => item.status === 'saved' || item.status === 'noop')) return false;
      await settleSavedContent(context.identity.modRoot);
      return true;
    },
    deploy: async (input) =>
      withFileTargets([{ ...context.identity, path: input.baseVersions[0]!.path }], async () => {
        await beginSavedWrite(
          (request) => deployJavaArtifact(input, request),
          () => [],
        ).result;
        await settleSavedContent(input.modRoot);
      }),
  });
  useCodeAnalysisSync(async () => {
    await engineering.read();
    await analysis.refresh();
  });
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
      await engineering.settle();
      await host.settle();
      await analysis.settle();
    },
    title: '关闭代码编辑器？',
    content: '这些文件有未保存修改，关闭后将丢弃修改。',
  });
  onMounted(() => {
    void participant.install().catch((error) => feedback.error(error, '代码编辑器操作失败'));
  });
  return { ...host, ready, analysis, actions, closing, project, engineering };
}
