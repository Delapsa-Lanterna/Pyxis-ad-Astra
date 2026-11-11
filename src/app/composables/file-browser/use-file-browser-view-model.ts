import { useFileBrowser, type FileBrowserTarget } from './use-file-browser';
import { queryFileTextTarget } from '@/services/file-browser.service';
import { openTextEditorWindow } from '@/windows/text-editor.window';
import { useAppFeedback } from '@/app/composables/use-app-feedback';

export type { FileBrowserTarget } from './use-file-browser';
export function useFileBrowserViewModel(getTarget: () => FileBrowserTarget | null) {
  const feedback = useAppFeedback();
  return useFileBrowser(getTarget, async (target, path, reads) => {
    await reads.consume('open', { ...target, path }, () => queryFileTextTarget(target.sessionId, path), {
      ready: (file) => {
        if (file) void openTextEditorWindow(file).catch((error) => feedback.error(error, '打开文本编辑器失败'));
      },
      error: (error) => feedback.error(error, '打开文件失败'),
    });
  });
}
