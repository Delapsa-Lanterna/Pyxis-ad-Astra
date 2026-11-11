import { onScopeDispose } from 'vue';
import { listenSavedContent } from '@/orchestrators/project-sync.orchestrator';
import { useAppFeedback } from '@/app/composables/use-app-feedback';

export function useCodeAnalysisSync(refresh: () => Promise<void>) {
  const feedback = useAppFeedback();
  let disposed = false,
    stop: (() => void) | undefined;
  void listenSavedContent(() => [refresh])
    .then((release) => {
      if (disposed) release();
      else stop = release;
    })
    .catch((error) => feedback.error(error, '监听 Java 来源失败'));
  onScopeDispose(() => {
    disposed = true;
    stop?.();
  });
}
