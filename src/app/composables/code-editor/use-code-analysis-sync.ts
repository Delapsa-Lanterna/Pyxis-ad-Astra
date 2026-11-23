import { onScopeDispose } from 'vue';
import { listenSavedContent } from '@/orchestrators/project-sync.orchestrator';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { normalizeFsPath, pathBelongsToRoot } from '@/shared/lib/paths';
import type { FileTextTarget } from '@/shared/types';

export function useCodeAnalysisSync(
  owner: Pick<FileTextTarget, 'sessionId' | 'modRoot'>,
  roots: () => readonly string[],
  refreshProject: () => Promise<void>,
  refreshSources: () => Promise<void>,
  refreshAnalysis: (paths: string[], mode: 'files' | 'configure' | 'references') => Promise<void>,
) {
  const feedback = useAppFeedback();
  let disposed = false,
    stop: (() => void) | undefined;
  void listenSavedContent((event) => {
    const change = event.result.javaProjectChange;
    if (!change) return;
    const own = change.modRoot !== null && normalizeFsPath(change.modRoot) === normalizeFsPath(owner.modRoot);
    // A published reference also receives its ordinary same-root delivery.
    if (own && !event.modRoot) return;
    return [
      async () => {
        if (change.sessions.includes(owner.sessionId)) await refreshProject();
        if (change.configuration) await refreshSources();
        const paths = change.sourcePaths.filter((path) =>
          roots().some((root) => pathBelongsToRoot(path, root) || pathBelongsToRoot(root, path)),
        );
        if (change.configuration) await refreshAnalysis(paths, event.modRoot ? 'configure' : 'references');
        else if (paths.length) await refreshAnalysis(paths, 'files');
      },
    ];
  })
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
