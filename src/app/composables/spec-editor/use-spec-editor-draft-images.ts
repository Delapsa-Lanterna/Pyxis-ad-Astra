import { computed, shallowRef, watch, onScopeDispose } from 'vue';
import { createReadTicketOwner } from '@/shared/runtime/read-request';
import { observeSavedContent, saveProjection } from '@/orchestrators/project-sync.orchestrator';
import { formatError } from '@/shared/lib/errors';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { normalizeFsPath } from '@/shared/lib/paths';
import type { ResourceRef, RowData } from '@/shared/types/index';
import type { SpecEditorInput } from './spec-editor.types';

export function useSpecEditorDraftImages<TImageData>(
  options: SpecEditorInput & {
    fields: readonly string[];
    errorPresentation?: 'notification' | 'inline';
    query: (
      sessionId: string,
      id: string,
      draft: RowData,
      signal?: AbortSignal,
    ) => Promise<{ resourceRefs: ResourceRef[]; spriteData: TImageData; diagnostic?: string }>;
  },
) {
  const value = shallowRef<{ resourceRefs: ResourceRef[]; spriteData: TImageData; diagnostic?: string } | null>(null);
  const loading = shallowRef(false),
    errorText = shallowRef('');
  const reads = createReadTicketOwner(),
    feedback = useAppFeedback();
  const source = computed(() =>
    options.target.value && options.context.value
      ? JSON.stringify([
          options.target.value.sessionId,
          options.target.value.id,
          options.context.value.baselineGeneration,
          options.fields.map((field) => options.draft.value[field] ?? null),
        ])
      : null,
  );
  async function refresh(required = false) {
    const target = options.target.value;
    reads.revoke();
    value.value = null;
    loading.value = false;
    errorText.value = '';
    if (!target || !options.context.value) return;
    loading.value = true;
    await reads.consume(
      'images',
      { ...target, source: source.value },
      (signal) => options.query(target.sessionId, target.id, options.draft.value, signal),
      {
        ready: (result) => {
          value.value = result;
        },
        error: (error) => {
          errorText.value = formatError(error);
          if (options.errorPresentation !== 'inline') feedback.error(error, '读取草稿贴图失败');

          if (required) throw error;
        },
        settled: () => {
          loading.value = false;
        },
      },
    );
  }
  watch(
    source,
    () => {
      reads.revoke();
      reads.schedule('images', () => void refresh());
    },
    { immediate: true, flush: 'sync' },
  );
  const stop = observeSavedContent(
    (event) => {
      const projection = saveProjection(event, options.target.value?.sessionId);
      if (!projection) return;
      if (projection.manifest.sessionId !== options.target.value?.sessionId) return;

      const paths = [
        ...(value.value?.resourceRefs ?? []).map((resource) => resource.relPath),
        ...options.fields.flatMap((field) => options.draft.value[field] ?? []).filter((path): path is string => typeof path === 'string'),
      ].map(normalizeFsPath);
      const resources = projection.invalidation.resources;
      if (projection.invalidation.session || resources.some((resource) => paths.includes(normalizeFsPath(resource.relPath))))
        return refresh(true);
    },
    (sessionId) => {
      if (sessionId === options.target.value?.sessionId) {
        reads.revoke('session');
        loading.value = false;
      }
    },
  );
  function dispose() {
    reads.revoke();
    loading.value = false;
    stop();
  }
  onScopeDispose(dispose);
  return {
    value: computed(() => value.value),
    loading: computed(() => loading.value),
    errorText: computed(() => errorText.value),
    dispose,
  };
}
