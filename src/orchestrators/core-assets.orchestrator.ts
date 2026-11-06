import { watch, type Ref } from 'vue';
import { useCoreAssetsStore, type CoreAssetState } from '@/stores/core-assets.store';
import { queryCoreFields, queryCoreGraphics, invalidateCoreCacheForRoot, setWindowCoreSubscription } from '@/services/core-assets.service';
import { recordLogBestEffort } from '@/services/app-log.service';
import { errorContextOf, errorDiagnosticOf } from '@/shared/lib/errors';
import { logFields } from '@/shared/lib/log-fields';
import { normalizeFsPath, pathBelongsToRoot } from '@/shared/lib/paths';
import { observeSavedContent, sessionContentUpdate, observeCoreContent } from '@/orchestrators/project-sync.orchestrator';
import type { DiscoveredField } from '@/shared/types';

class CoreAssetLoader<T> {
  private revision = 0;
  private pending: { generation: number; promise: Promise<void> } | null = null;
  constructor(
    private readonly store: ReturnType<typeof useCoreAssetsStore>,
    private readonly lifetime: { generation: number; disposed: boolean },
    private readonly state: () => CoreAssetState<T>,
    private readonly query: (root: string) => Promise<T>,
    private readonly ready: () => Promise<void>,
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
    const promise = this.ready()
      .then(() => this.query(capturedRoot))
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
  fields: CoreAssetLoader<Record<string, DiscoveredField[]>>;
  graphics: CoreAssetLoader<string[]>;
}

const loaders = new WeakMap<ReturnType<typeof useCoreAssetsStore>, CoreLoader>();

export function startCoreAssetsLoading(root: Readonly<Ref<string | null>>): () => void {
  const store = useCoreAssetsStore();
  const lifetime = { generation: 0, disposed: false };
  let settingSource = Promise.resolve();

  const runtime = {
    fields: new CoreAssetLoader(
      store,
      lifetime,
      () => store.fields,
      queryCoreFields,
      () => settingSource,
    ),
    graphics: new CoreAssetLoader(
      store,
      lifetime,
      () => store.graphics,
      queryCoreGraphics,
      () => settingSource,
    ),
  };
  loaders.set(store, runtime);
  store.reset(root.value);
  const refreshTasks = (sources: readonly { relPath: string }[]) => {
    const affected = (directory: string) =>
      sources.some(({ relPath }) => pathBelongsToRoot(relPath, directory) || pathBelongsToRoot(directory, relPath));
    const tasks = [];
    if (['data/world/factions', 'data/hulls', 'data/weapons', 'data/shipsystems/wpn'].some(affected))
      tasks.push(() => runtime.fields.load(true, true));
    if (affected('graphics')) tasks.push(() => runtime.graphics.load(true, true));
    return tasks;
  };
  const subscription = observeCoreContent((changedRoot, sources) => {
    if (lifetime.disposed || !store.root || normalizeFsPath(store.root) !== normalizeFsPath(changedRoot)) return;
    return refreshTasks(sources);
  });
  settingSource = subscription.ready;
  const registerSource = (value: string | null) => {
    settingSource = settingSource
      .then(() => setWindowCoreSubscription(value))
      .catch((error) => {
        const diagnostic = errorDiagnosticOf(error);
        recordLogBestEffort({
          level: 'error',
          code: diagnostic.code,
          message: diagnostic.message,
          path: diagnostic.location?.path ?? null,
          line: null,
          fields: logFields({ root: value }),
        });
      });
  };
  registerSource(root.value);
  const stopChanges = observeSavedContent((change) => {
    const update = change.originWindowLabel === 'source-watch' ? null : sessionContentUpdate(change, change.sessionId);
    if (!update) return;

    const { manifest, invalidation } = update;
    if (
      lifetime.disposed ||
      !store.root ||
      !manifest.starsectorRoot ||
      normalizeFsPath(store.root) !== normalizeFsPath(manifest.starsectorRoot)
    )
      return;
    return refreshTasks(invalidation.resources.filter((source) => source.source === 'core'));
  });
  const stop = watch(
    root,
    (nextRoot) => {
      lifetime.generation++;
      registerSource(nextRoot);
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
    subscription.release();
    registerSource(null);
    loaders.delete(store);
    store.reset(null);
  };
}

export function loadCoreFields(): Promise<void> {
  return loaders.get(useCoreAssetsStore())!.fields.load();
}

export async function refreshCoreAssets(root: string): Promise<void> {
  const store = useCoreAssetsStore(),
    fields = store.fields,
    runtime = loaders.get(store)!;
  await invalidateCoreCacheForRoot(root);
  if (store.root === root && store.fields === fields && loaders.get(store) === runtime)
    await Promise.all([runtime.fields.load(true, true), runtime.graphics.load(true, true)]);
}

export function loadCoreGraphics(): Promise<void> {
  return loaders.get(useCoreAssetsStore())!.graphics.load();
}
