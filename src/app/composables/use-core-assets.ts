import { computed, onScopeDispose, ref, watch, type Ref } from 'vue';
import { useCoreAssetsStore } from '@/stores/core-assets.store';
import { loadCoreGraphics, startCoreAssetsLoading } from '@/orchestrators/core-assets.orchestrator';
import { queryCoreRoot } from '@/services/core-assets.service';
import type { CoreRootPayload } from '@/shared/types';
import { useQueryReadOwner } from './use-query-read-owner';
import { recordWindowEventHandlerError } from '@/orchestrators/window-event-errors.orchestrator';

export function useCoreAssetsLifecycle(context: Readonly<Ref<CoreRootPayload>>, settingsRoot: () => string | null) {
  const root = ref<string | null>(null);
  const reads = useQueryReadOwner();
  watch(
    [context, settingsRoot],
    ([payload]) => {
      reads.revoke('consumer', 'core-root');
      root.value = null;
      reads.schedule('core-root', () => {
        void reads.consume('core-root', payload, () => queryCoreRoot(payload), {
          ready: (value) => {
            root.value = value;
          },
          error: (error) => recordWindowEventHandlerError(error, 'core-root'),
        });
      });
    },
    { immediate: true, flush: 'sync' },
  );
  onScopeDispose(startCoreAssetsLoading(root));
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
