import { onUnmounted, ref, watch } from 'vue';
import type { FieldSchema } from '@/domain/schema/schema.types';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import { mapSourceGroupsToSelectOptions, type SelectOption } from '@/domain/schema/schema-options';
import { isCsvSource } from '@/domain/schema/csv-source-options';
import { isConfigSource, isEntitySource } from '@/domain/schema/schema-sources';
import type { ResourceRef } from '@/shared/types';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { querySourceOptionCatalog, hasSourceInvalidation } from '@/services/source-options.service';
import { hasResourceInvalidation } from '@/services/resource-media.service';
import { observeSavedContent, saveProjection } from '@/orchestrators/project-sync.orchestrator';

export function observeSchemaSourceOptions(
  context: SchemaRuntimeContext,
  source: string,
  resources: () => ResourceRef[],
  listener: () => void | Promise<void>,
) {
  return observeSavedContent((event) => {
    const projection = saveProjection(event, context.sessionId);
    if (
      projection &&
      (hasSourceInvalidation(projection.invalidation, source) || hasResourceInvalidation(projection.invalidation, resources()))
    )
      return listener();
  });
}

export function useSchemaSourceOptions(args: {
  field: () => FieldSchema;
  value: () => unknown;
  runtimeContext: () => SchemaRuntimeContext | null | undefined;
}) {
  const loadedOptions = ref<SelectOption[]>([]);
  const feedback = useAppFeedback();
  const reads = useQueryReadOwner();
  let stopInvalidation: (() => void) | null = null;

  // Context identity tracks entity-dependent catalogs; selected values remain ghost options.
  watch(
    () => [args.runtimeContext()?.sessionId ?? null, args.runtimeContext()?.sourceContextKey ?? null, args.field().source ?? null] as const,
    () => {
      loadedOptions.value = [];
      void reloadSourceOptions();
    },
    { immediate: true },
  );

  watch(
    () => [args.runtimeContext()?.sessionId ?? null, args.runtimeContext()?.sourceContextKey ?? null, args.field().source ?? ''] as const,
    () => {
      stopInvalidation?.();
      const context = args.runtimeContext();
      const source = args.field().source ?? '';
      stopInvalidation = context
        ? context.subscribeSourceOptionInvalidation
          ? context.subscribeSourceOptionInvalidation(source, loadedSourceResourceRefs, () => reloadSourceOptions(true))
          : observeSchemaSourceOptions(context, source, loadedSourceResourceRefs, () => reloadSourceOptions(true))
        : null;
    },
    { immediate: true },
  );

  onUnmounted(() => {
    stopInvalidation?.();
  });

  async function reloadSourceOptions(required = false) {
    const context = args.runtimeContext();
    const sessionId = context?.sessionId ?? null;
    const source = args.field().source ?? null;
    reads.revoke('consumer', 'source');
    if (
      !sessionId ||
      !source ||
      (!isCsvSource(source) &&
        !isEntitySource(source) &&
        !isConfigSource(source) &&
        source !== 'hull:builtInWeaponSlots' &&
        source !== 'hull:weaponSlots' &&
        source !== 'hull:moduleSlots' &&
        source !== 'hull:ids')
    ) {
      loadedOptions.value = [];
      return;
    }

    await reads.consume(
      'source',
      { sessionId, source },
      (signal) =>
        context?.querySourceOptions ? context.querySourceOptions(source, signal) : querySourceOptionCatalog(sessionId, source, signal),
      {
        ready: (groups) => {
          loadedOptions.value = groups ? mapSourceGroupsToSelectOptions(groups) : [];
        },
        error: (error) => {
          loadedOptions.value = [];
          feedback.error(error, '加载字段来源失败');

          if (required) throw error;
        },
      },
    );
  }

  function loadedSourceResourceRefs(): ResourceRef[] {
    return loadedOptions.value.flatMap((option) => [
      ...(option.resourceRef ? [option.resourceRef] : []),
      ...(option.children ?? []).flatMap((child) => (child.resourceRef ? [child.resourceRef] : [])),
    ]);
  }

  return {
    reloadSourceOptions,
    sourceOptions: loadedOptions,
  };
}
