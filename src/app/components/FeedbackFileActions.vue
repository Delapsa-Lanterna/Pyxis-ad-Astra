<template>
  <n-button v-for="action in actions" :key="action.label" size="small" secondary :type="action.type" @click="action.run">
    {{ action.label }}
  </n-button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { FeedbackNotice } from '@/shared/types';
import type { FeedbackLevel } from '@/shared/types';
import { extractFileReferenceFromError } from '@/shared/lib/errors';
import { useAppFeedback } from '@/app/composables/use-app-feedback';

const props = defineProps<{ notice: FeedbackNotice; level: FeedbackLevel }>();
const feedback = useAppFeedback();
const actions = computed(() => {
  const reference = extractFileReferenceFromError(props.notice.diagnostic);
  return reference ? feedback.fileActions(reference, props.level, props.notice.diagnostic.code) : [];
});
</script>
