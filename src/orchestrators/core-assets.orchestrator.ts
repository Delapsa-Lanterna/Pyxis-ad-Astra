import { watch, type Ref } from 'vue';
import { useCoreAssetsStore, type CoreAssetState } from '@/stores/core-assets.store';
import { queryCoreFields, queryCoreGraphics } from '@/services/core-assets.service';
import { recordLogBestEffort } from '@/services/app-log.service';
import { errorContextOf, errorDiagnosticOf } from '@/shared/lib/errors';
import { logFields } from '@/shared/lib/log-fields';
import { normalizeFsPath, pathBelongsToRoot } from '@/shared/lib/paths';
import { observeSavedContent, saveProjection } from '@/orchestrators/project-sync.orchestrator';

class CoreAssetLoader<T> {
  private revision = 0;
  private pending: { generation: number; promise: Promise<void> } | null = null;
  constructor(
    private readonly store: ReturnType<typeof useCoreAssetsStore>,
    private readonly lifetime: { generation: number; disposed: boolean },
    private readonly state: () => CoreAssetState<T>,
    private readonly query: (root: string) => Promise<T>,
  ) {}
  load(refresh = false, required = false): Promise<void> {
    if (refresh) {
      this.revision++;
      this.pending = null;
      this.state().status = 'idle';
    }
    const capturedRoot = this.store.root;
    const capturedGeneration = this.lifetime.generation;
    const capturedRevision = this.revision;
    if (!capturedRoot || this.state().status === 'ready') return Promise.resolve();
    if (this.pending?.generation === capturedGeneration) return this.pending.promise;
    const capturedState = this.state();
    capturedState.status = 'loading';
    capturedState.error = null;
    const accepts = () => !this.lifetime.disposed && this.lifetime.generation === capturedGeneration && this.revision === capturedRevision;
    const promise = this.query(capturedRoot)
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
        if (required) throw error;
      })
      .finally(() => {
        if (accepts()) this.pending = null;
      });
    this.pending = { generation: capturedGeneration, promise };
    return promise;
  }
}

interface CoreLoader {
  fields: CoreAssetLoader<Record<string, import('@/shared/types').DiscoveredField[]>>;
  graphics: CoreAssetLoader<string[]>;
}

const loaders = new WeakMap<ReturnType<typeof useCoreAssetsStore>, CoreLoader>();

export function startCoreAssetsLoading(root: Readonly<Ref<string | null>>): () => void {
  const store = useCoreAssetsStore();
  const lifetime = { generation: 0, disposed: false };

  const runtime = {
    fields: new CoreAssetLoader(store, lifetime, () => store.fields, queryCoreFields),
    graphics: new CoreAssetLoader(store, lifetime, () => store.graphics, queryCoreGraphics),
  };
  loaders.set(store, runtime);
  store.reset(root.value);
  const stopChanges = observeSavedContent((change) => {
    const projection = saveProjection(change, change.sessionId);
    if (!projection) return;

    const { manifest, invalidation } = projection;
    if (
      lifetime.disposed ||
      !store.root ||
      !manifest.starsectorRoot ||
      normalizeFsPath(store.root) !== normalizeFsPath(manifest.starsectorRoot)
    )
      return;
    const paths = invalidation.resources.filter((source) => source.source === 'core').map((source) => source.relPath);
    const affected = (directory: string) => paths.some((path) => pathBelongsToRoot(path, directory) || pathBelongsToRoot(directory, path));
    const tasks = [];
    if (['data/world/factions', 'data/hulls', 'data/weapons'].some(affected)) tasks.push(() => runtime.fields.load(true, true));
    if (affected('graphics')) tasks.push(() => runtime.graphics.load(true, true));
    return tasks;
  });
  const stop = watch(
    root,
    (nextRoot) => {
      lifetime.generation++;
      store.reset(nextRoot);
      void runtime.fields.load();
      void runtime.graphics.load();
    },
    { flush: 'sync' },
  );
  return () => {
    lifetime.disposed = true;
    lifetime.generation++;
    stop();
    stopChanges();
    loaders.delete(store);
    store.reset(null);
  };
}

export function loadCoreFields(): Promise<void> {
  return loaders.get(useCoreAssetsStore())!.fields.load();
}

export function loadCoreGraphics(): Promise<void> {
  return loaders.get(useCoreAssetsStore())!.graphics.load();
}
