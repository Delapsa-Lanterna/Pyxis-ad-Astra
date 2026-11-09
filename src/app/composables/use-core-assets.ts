import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import { useCoreAssetsStore } from '@/stores/core-assets.store';
import { loadCoreGraphics, startCoreAssetsLoading } from '@/orchestrators/core-assets.orchestrator';
import { queryCoreRoot } from '@/services/core-assets.service';
import type { CoreRootPayload } from '@/shared/types';
import { useQueryReadOwner } from './use-query-read-owner';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';
import { normalizeFsPath } from '@/shared/lib/paths';
import { invalidatedRead } from '@/shared/runtime/read-request';

export function useCoreAssetsLifecycle(context: Readonly<Ref<CoreRootPayload>>, settingsRoot: () => string | null) {
  const root = ref<string | null>(null);
  const reads = useQueryReadOwner();
  let ready = Promise.resolve();
  let disposed = false;
  watch(
    [context, settingsRoot],
    ([payload], _previous, onCleanup) => {
      reads.revoke('consumer', 'core-root');
      let finish!: () => void;
      ready = new Promise<void>((resolve) => {
        finish = resolve;
      });
      onCleanup(finish);
      reads.schedule('core-root', () => {
        void reads.consume('core-root', payload, () => queryCoreRoot(payload), {
          ready: (value) => {
            // Context changes may resolve to the same physical root and keep its active products.
            if (root.value && value && normalizeFsPath(root.value) === normalizeFsPath(value)) return;
            root.value = value;
          },
          error: (error) => {
            root.value = null;
            recordWindowEventHandlerError(error, 'core-root');
          },
          settled: finish,
        });
      });
    },
    { immediate: true, flush: 'sync' },
  );
  onScopeDispose(startCoreAssetsLoading(root));
  onScopeDispose(() => {
    disposed = true;
  });
  return {
    root: computed(() => root.value),
    whenRootReady: async () => {
      const captured = ready;
      await captured;
      if (disposed || captured !== ready) throw invalidatedRead(context.value, 'consumer');
      return root.value;
    },
  };
}

export function useCoreGraphics() {
  const store = useCoreAssetsStore();
  return {
    graphicsPaths: computed(() => store.graphics.content),
    loaded: computed(() => store.graphics.status === 'ready'),
    loading: computed(() => store.graphics.status === 'loading'),
    starsectorRoot: computed(() => store.root),
    loadGraphics: loadCoreGraphics,
  };
}
