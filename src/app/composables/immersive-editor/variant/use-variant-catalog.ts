import { subscribeProjectChanges, projectChangeSessionId } from '@/orchestrators/project-sync.orchestrator';
import { ref, shallowRef, watch, onScopeDispose } from 'vue';
import type { JointEditRoot, JointVariantCatalogKind, ReadonlyVariantEntry, JointVariantCatalogRead, DeepReadonly } from '@/shared/types';
import { queryJointVariantCatalog, hasJointEditInvalidation } from '@/services/joint-edit.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { formatError } from '@/shared/lib/errors';

export function useVariantCatalog(
  root: () => JointEditRoot,
  kind: () => JointVariantCatalogKind,
  enabled: () => boolean = () => true,
  source: () => import('@/shared/types').ResourceSource | undefined = () => undefined,
) {
  const snapshot = shallowRef<DeepReadonly<JointVariantCatalogRead> | null>(null),
    entries = shallowRef<readonly ReadonlyVariantEntry[]>([]),
    loading = ref(false),
    errorText = ref(''),
    reads = useQueryReadOwner();
  async function load() {
    loading.value = true;
    errorText.value = '';
    await reads.consume(
      'catalog',
      { root: root(), kind: kind(), source: source() },
      (signal) => queryJointVariantCatalog(root(), kind(), signal, source()),
      {
        ready: (value) => {
          snapshot.value = value;
          entries.value = snapshot.value.catalog.entries;
        },
        error: (error) => {
          errorText.value = formatError(error);
        },
        settled: () => {
          loading.value = false;
        },
      },
    );
  }
  watch(
    () => (enabled() ? [root(), kind(), source()] : null),
    () => {
      entries.value = [];
      snapshot.value = null;
      if (!enabled()) {
        reads.revoke();
        loading.value = false;
        return;
      }
      void load();
    },
    { immediate: true },
  );
  onScopeDispose(
    subscribeProjectChanges((event) => {
      if (!enabled() || projectChangeSessionId(event) !== root().sessionId) return;
      if (event.kind === 'closed') {
        reads.revoke('session');
        entries.value = [];
        snapshot.value = null;
        loading.value = false;
      } else if (hasJointEditInvalidation(event.projection.invalidation))
        reads.schedule('catalog', () => {
          void load();
        });
    }),
  );
  return { entries, snapshot, loading, errorText, load };
}
