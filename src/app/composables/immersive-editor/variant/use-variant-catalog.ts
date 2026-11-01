import { observeSavedContent, saveProjection } from '@/orchestrators/project-sync.orchestrator';
import { ref, shallowRef, watch, onScopeDispose } from 'vue';
import type {
  JointEditRoot,
  JointVariantCatalogKind,
  ReadonlyVariantEntry,
  JointVariantCatalogRead,
  DeepReadonly,
  ResourceSource,
} from '@/shared/types';
import { queryJointVariantCatalog, hasJointEditInvalidation } from '@/services/joint-edit.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { formatError } from '@/shared/lib/errors';

export function useVariantCatalog(
  root: () => JointEditRoot,
  kind: () => JointVariantCatalogKind,
  enabled: () => boolean = () => true,
  source: () => ResourceSource | undefined = () => undefined,
) {
  const snapshot = shallowRef<DeepReadonly<JointVariantCatalogRead> | null>(null),
    entries = shallowRef<readonly ReadonlyVariantEntry[]>([]),
    loading = ref(false),
    errorText = ref(''),
    reads = useQueryReadOwner();
  async function load(required = false) {
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

          if (required) throw error;
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
    observeSavedContent(
      (event) => {
        const projection = saveProjection(event, root().sessionId);
        if (!projection) return undefined;
        if (!enabled() || projection.manifest.sessionId !== root().sessionId) return undefined;
        if (hasJointEditInvalidation(projection.invalidation)) return load(true);
        return undefined;
      },
      (sessionId) => {
        if (sessionId !== root().sessionId) return;
        reads.revoke('session');
        entries.value = [];
        snapshot.value = null;
        loading.value = false;
      },
    ),
  );
  return { entries, snapshot, loading, errorText, load };
}
