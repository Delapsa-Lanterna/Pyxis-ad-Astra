import { watch, type Ref } from 'vue';
import { useCoreAssetsStore, type CoreAssetState } from '@/stores/core-assets.store';
import { queryCoreFields, queryCoreGraphics } from '@/services/core-assets.service';
import { recordLogBestEffort } from '@/services/app-log.service';
import { errorContextOf, errorDiagnosticOf } from '@/shared/lib/errors';
import { logFields } from '@/shared/lib/log-fields';
import { normalizeFsPath, pathBelongsToRoot } from '@/shared/lib/paths';
import { subscribeProjectChanges } from '@/orchestrators/project-sync.orchestrator';

interface CoreLoader {
  fields: () => Promise<void>;
  graphics: () => Promise<void>;
}

const loaders = new WeakMap<ReturnType<typeof useCoreAssetsStore>, CoreLoader>();

export function startCoreAssetsLoading(root: Readonly<Ref<string | null>>): () => void {
  const store = useCoreAssetsStore();
  let generation = 0;
  let disposed = false;

  function loader<T>(state: () => CoreAssetState<T>, query: (root: string) => Promise<T>) {
    let revision = 0;
    let pending: { generation: number; promise: Promise<void> } | null = null;
    return function load(refresh = false): Promise<void> {
      if (refresh) {
        revision++;
        pending = null;
        state().status = 'idle';
      }
      const capturedRoot = store.root;
      const capturedGeneration = generation;
      const capturedRevision = revision;
      if (!capturedRoot || state().status === 'ready') return Promise.resolve();
      if (pending?.generation === capturedGeneration) return pending.promise;
      const capturedState = state();
      capturedState.status = 'loading';
      capturedState.error = null;
      const accepts = () => !disposed && generation === capturedGeneration && revision === capturedRevision;
      const promise = query(capturedRoot)
        .then((content) => {
          if (!accepts()) return;
          capturedState.content = content;
          capturedState.status = 'ready';
        })
        .catch((error: unknown) => {
          if (!accepts()) return;
          capturedState.status = 'error';
          const diagnostic = errorDiagnosticOf(error);
          capturedState.error = diagnostic;
          recordLogBestEffort({
            level: 'error',
            code: diagnostic.code,
            message: diagnostic.message,
            path: diagnostic.location?.path ?? null,
            line: diagnostic.location?.line ?? null,
            fields: logFields({ ...errorContextOf(error), root: capturedRoot, column: diagnostic.location?.column }),
          });
        })
        .finally(() => {
          if (accepts()) pending = null;
        });
      pending = { generation: capturedGeneration, promise };
      return promise;
    };
  }

  const runtime = {
    fields: loader(() => store.fields, queryCoreFields),
    graphics: loader(() => store.graphics, queryCoreGraphics),
  };
  loaders.set(store, runtime);
  store.reset(root.value);
  const stopChanges = subscribeProjectChanges((change) => {
    if (change.kind === 'closed') return;
    const { manifest, invalidation } = change.projection;
    if (disposed || !store.root || !manifest.starsectorRoot || normalizeFsPath(store.root) !== normalizeFsPath(manifest.starsectorRoot))
      return;
    const paths = invalidation.resources.filter((source) => source.source === 'core').map((source) => source.relPath);
    const affected = (directory: string) => paths.some((path) => pathBelongsToRoot(path, directory) || pathBelongsToRoot(directory, path));
    if (['data/world/factions', 'data/hulls', 'data/weapons'].some(affected)) void runtime.fields(true);
    if (affected('graphics')) void runtime.graphics(true);
  });
  const stop = watch(
    root,
    (nextRoot) => {
      generation++;
      store.reset(nextRoot);
      void runtime.fields();
      void runtime.graphics();
    },
    { flush: 'sync' },
  );
  return () => {
    disposed = true;
    generation++;
    stop();
    stopChanges();
    loaders.delete(store);
    store.reset(null);
  };
}

export function loadCoreFields(): Promise<void> {
  return loaders.get(useCoreAssetsStore())!.fields();
}

export function loadCoreGraphics(): Promise<void> {
  return loaders.get(useCoreAssetsStore())!.graphics();
}
