import { computed, onScopeDispose, type Ref } from 'vue';
import { useCoreAssetsStore } from '@/stores/core-assets.store';
import { loadCoreGraphics, startCoreAssetsLoading } from '@/orchestrators/core-assets.orchestrator';

export function useCoreAssetsLifecycle(root: Readonly<Ref<string | null>>) {
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
