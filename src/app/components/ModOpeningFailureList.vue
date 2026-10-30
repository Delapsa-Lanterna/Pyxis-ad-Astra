<template>
  <div v-if="failures.length > 0" class="mod-opening-failure-list ui-layout-grid ui-layout-shrink">
    <div
      v-for="failure in failures"
      :key="failure.modRoot"
      class="mod-opening-failure-item ui-layout-grid ui-layout-shrink ui-layout-center"
    >
      <div class="mod-opening-failure-content ui-layout-grid ui-layout-shrink">
        <strong class="mod-opening-failure-content-value ui-emphasis ui-text-wrap ui-text-small">{{ failureMessage(failure) }}</strong>
        <span class="mod-opening-failure-content-label ui-text-truncate ui-text-muted ui-layout-shrink">{{
          failure.file?.path ?? failure.modRoot
        }}</span>
      </div>
      <div class="game-overview-actions action-group">
        <FeedbackFileActions :notice="modOpeningFailureNotice(failure)" level="error" />
        <n-button size="small" @click="$emit('dismiss-failure', failure.modRoot)">关闭提示</n-button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ModOpeningFailure } from '@/shared/types';
import { appendFileReferenceLocation } from '@/shared/lib/errors';
import FeedbackFileActions from '@/app/components/FeedbackFileActions.vue';
import { modOpeningFailureNotice } from '@/domain/project/load-diagnostics';

defineProps<{ failures: ModOpeningFailure[] }>();
defineEmits<{
  'dismiss-failure': [modRoot: string];
}>();

function failureMessage(failure: ModOpeningFailure): string {
  const file = failure.file;
  return appendFileReferenceLocation(failure.message, file ? { ...file, message: failure.message } : null);
}
</script>
