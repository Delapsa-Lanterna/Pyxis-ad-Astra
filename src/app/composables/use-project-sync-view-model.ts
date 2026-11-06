import { computed, ref } from 'vue';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { retryPendingWrites } from '@/orchestrators/project-sync.orchestrator';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { formatError } from '@/shared/lib/errors';
import { retrySourceWatch } from '@/services/project-sync.service';

export function useProjectSyncViewModel() {
  const sync = useProjectSyncStore();
  const feedback = useAppFeedback();
  const retrying = ref(false);
  const failedCount = computed(
    () => sync.pending.filter((entry) => entry.error !== null && entry.event?.reason !== 'refresh' && entry.event !== null).length,
  );
  const externalCount = computed(
    () => sync.pending.filter((entry) => entry.error !== null && (!entry.event || entry.event.reason === 'refresh')).length,
  );
  const sourceCount = computed(() => sync.sourceIssues.length);
  const blockedCount = computed(() => sync.blocked.filter((work) => work.phase === 'preparing').length);
  const issues = computed(() => [
    ...sync.blocked.map((work) => ({
      id: work.requestId,
      path: work.diagnostic.location?.path ?? work.modRoot,
      message: formatError(work.diagnostic),
      diagnostic: work.diagnostic.message,
    })),
    ...sync.sourceIssues.map((source) => ({
      id: source.root,
      path: source.root,
      message: formatError(source.diagnostic),
      diagnostic: source.diagnostic!.message,
    })),
  ]);
  async function retry() {
    retrying.value = true;
    try {
      for (const source of sync.sourceIssues) await retrySourceWatch(source.root);
      await retryPendingWrites();
    } catch (error) {
      feedback.error(error, '处理保存恢复或内容更新失败');
    } finally {
      retrying.value = false;
    }
  }
  return {
    failedCount,
    externalCount,
    sourceCount,
    scanningSources: computed(() => sync.scanningSources),
    blockedCount,
    issues,
    retrying: computed(() => retrying.value || sync.scanningSources > 0),
    retry,
  };
}
