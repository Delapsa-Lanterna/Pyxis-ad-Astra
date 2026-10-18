import { computed } from 'vue';
import { useCoreAssetsStore } from '@/stores/core-assets.store';
import { loadCoreFields } from '@/orchestrators/core-assets.orchestrator';
import { mergeSchemaWithCoreFields } from '@/domain/schema/schema-core-fields';
import { getSchema } from '@/domain/schema/config-schema-registry';

export function useCoreSchema() {
  const store = useCoreAssetsStore();
  return {
    coreFields: computed(() => store.fields.content),
    loaded: computed(() => store.fields.status === 'ready'),
    loading: computed(() => store.fields.status === 'loading'),
    starsectorRoot: computed(() => store.root),
    getMergedSchema: (id: string) => {
      const schema = getSchema(id);
      return schema ? mergeSchemaWithCoreFields(schema, store.fields.content[id] ?? []) : null;
    },
    loadCoreFields,
  };
}
