import { finishCodeEditorOpen, subscribeCodeEditor } from '@/services/code-editor.service';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import type { TextFiles } from '@/app/composables/text-file-editing/text-files';

export function useCodeFileRequests(host: TextFiles, ready: Promise<unknown>) {
  const feedback = useAppFeedback(),
    deliveries = new Set<string>();
  return ready.then(async () => {
    if (host.isDisposed()) return;
    await subscribeCodeEditor((message) => {
      if (host.isDisposed() || deliveries.has(message.key)) return;
      deliveries.add(message.key);
      void host
        .openFiles(message.files)
        .then(async (results) => {
          if (!host.isDisposed()) await finishCodeEditorOpen(message.key, results);
        })
        .catch((error) => {
          if (!host.isDisposed()) feedback.error(error, '打开文件失败');
        })
        .finally(() => deliveries.delete(message.key));
    });
  });
}
