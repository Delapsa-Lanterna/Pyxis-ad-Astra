import { subscribeProjectChanges, projectChangeSessionId } from '@/orchestrators/project-sync.orchestrator';
import { hasTableInvalidation } from '@/services/csv-table.service';
import { computed, ref, watch, onScopeDispose } from 'vue';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useAppFeedback } from '@/app/composables/use-app-feedback';

import type { CsvRowPreviewTarget } from '@/shared/types';

export function useCsvRowPreview(options: {
  target: () => CsvRowPreviewTarget | null;
  query: (target: CsvRowPreviewTarget, signal?: AbortSignal) => Promise<string>;
}) {
  const src = ref('');
  const reads = useQueryReadOwner();
  const feedback = useAppFeedback();
  const key = computed(() => JSON.stringify(options.target()));
  async function load() {
    const target = options.target();
    if (!target) return;
    await reads.consume('preview', target, (signal) => options.query(target, signal), {
      ready: (value) => {
        src.value = value;
      },
      error: (error) => feedback.error(error, '加载行预览失败'),
    });
  }
  watch(
    key,
    () => {
      reads.revoke();
      src.value = '';
      void load();
    },
    { immediate: true },
  );
  const stopQuery = subscribeProjectChanges((event) => {
    if (projectChangeSessionId(event) !== options.target()?.sessionId) return;
    if (event.kind === 'closed') {
      reads.revoke();
      return;
    }
    if (
      hasTableInvalidation(event.projection.invalidation, 'csv-row-preview', options.target()!.table) ||
      event.projection.invalidation.resources.length > 0
    )
      reads.schedule('preview', () => {
        void load();
      });
  });
  onScopeDispose(() => {
    stopQuery();
  });
  return src;
}
