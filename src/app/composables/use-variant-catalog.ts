import { ref, shallowRef, watch, onScopeDispose } from 'vue';
import type { JointEditRoot, JointVariantCatalogKind, JointVariantEntry, JointVariantCatalogRead } from '@/shared/types';
import { queryJointVariantCatalog } from '@/services/joint-edit.service';
import { useQueryReadOwner } from './use-query-read-owner';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { formatError } from '@/shared/lib/errors';
import { subscribeQueryInvalidations, hasQueryInvalidation } from '@/services/query-cache.service';
export function useVariantCatalog(root: () => JointEditRoot, kind: () => JointVariantCatalogKind, enabled: () => boolean = () => true) {
  const snapshot = shallowRef<JointVariantCatalogRead | null>(null),
    entries = shallowRef<JointVariantEntry[]>([]),
    loading = ref(false),
    errorText = ref(''),
    reads = useQueryReadOwner();
  async function load() {
    loading.value = true;
    errorText.value = '';
    await reads.consume('catalog', { root: root(), kind: kind() }, (signal) => queryJointVariantCatalog(root(), kind(), signal), {
      ready: (value) => {
        snapshot.value = cloneQuerySnapshot<JointVariantCatalogRead>(value);
        entries.value = snapshot.value.catalog.entries;
      },
      error: (error) => {
        errorText.value = formatError(error);
      },
      settled: () => {
        loading.value = false;
      },
    });
  }
  watch(
    () => (enabled() ? [root(), kind()] : null),
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
    subscribeQueryInvalidations((event) => {
      if (!enabled() || event.sessionId !== root().sessionId) return;
      if (event.scope === 'session') {
        reads.revoke('session');
        entries.value = [];
        snapshot.value = null;
        loading.value = false;
      } else if (hasQueryInvalidation(event, 'joint-edit-catalog'))
        reads.schedule('catalog', () => {
          void load();
        });
    }),
  );
  return { entries, snapshot, loading, errorText, load };
}
