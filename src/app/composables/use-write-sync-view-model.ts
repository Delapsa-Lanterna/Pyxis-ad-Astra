import { computed, ref } from 'vue';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { retryPendingWrites } from '@/orchestrators/project-sync.orchestrator';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { formatError } from '@/shared/lib/errors';

export function useWriteSyncViewModel() {
  const sync = useProjectSyncStore();
  const feedback = useAppFeedback();
  const retrying = ref(false);
  const failedCount = computed(() => sync.pending.filter((entry) => entry.error !== null).length);
  const blockedCount = computed(() => sync.blocked.filter((work) => work.phase === 'preparing').length);
  const issues = computed(() =>
    sync.blocked.map((work) => ({
      id: work.requestId,
      path: work.diagnostic.location?.path ?? work.modRoot,
      message: formatError(work.diagnostic),
      diagnostic: work.diagnostic.message,
    })),
  );
  async function retry() {
    retrying.value = true;
    try {
      await retryPendingWrites();
    } catch (error) {
      feedback.error(error, '处理保存恢复或内容更新失败');
    } finally {
      retrying.value = false;
    }
  }
  return { failedCount, blockedCount, issues, retrying, retry };
}
