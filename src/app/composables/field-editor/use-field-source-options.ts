import { onUnmounted, ref, watch } from 'vue';
import type { FieldSchema } from '@/domain/schema/schema.types';
import type { FieldEditorContext } from '@/domain/field-editor/field-editor-context';
import { mapSourceGroupsToSelectOptions, type SelectOption } from '@/domain/field-editor/field-options';
import { isCsvFieldSource, isConfigFieldSource, isEntityFieldSource } from '@/domain/schema/schema-source-definitions';
import type { ResourceRef } from '@/shared/types';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { querySourceOptionCatalog, hasSourceInvalidation } from '@/services/source-catalog.service';
import { hasResourceInvalidation } from '@/services/resource-media.service';
import { observeSavedContent, sessionContentUpdate } from '@/orchestrators/project-sync.orchestrator';

export function observeFieldSourceOptions(
  context: FieldEditorContext,
  source: string,
  resources: () => ResourceRef[],
  listener: () => void | Promise<void>,
) {
  return observeSavedContent((event) => {
    const update = sessionContentUpdate(event, context.sessionId);
    if (update && (hasSourceInvalidation(update.invalidation, source) || hasResourceInvalidation(update.invalidation, resources())))
      return listener();
  });
}

export function useFieldSourceOptions(args: {
  field: () => FieldSchema;
  value: () => unknown;
  runtimeContext: () => FieldEditorContext | null | undefined;
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
          : observeFieldSourceOptions(context, source, loadedSourceResourceRefs, () => reloadSourceOptions(true))
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
      (!isCsvFieldSource(source) &&
        !isEntityFieldSource(source) &&
        !isConfigFieldSource(source) &&
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
