<template>
  <div class="window-runtime ui-layout-contained" :inert="closing || undefined">
    <n-config-provider abstract :namespace="closing ? 'window-runtime-overlays' : undefined"><slot /></n-config-provider>
  </div>
</template>
<script setup lang="ts">
import { useAppLifecycleAssembly } from '@/app/composables/use-app-lifecycle-assembly';
import { useDialog } from 'naive-ui/es/dialog';
import { useMessage } from 'naive-ui/es/message';
import { createWindowFeedback } from '@/app/app-feedback-assembly';
import { provideAppFeedback } from '@/app/composables/use-app-feedback';
import { useEditTargetHandoff } from '@/app/composables/use-edit-target-handoff';
import { watch } from 'vue';
import { applicationLogError } from '@/shared/runtime/app-log-queue';
const closing = useAppLifecycleAssembly();
const feedback = createWindowFeedback(useMessage(), useDialog(), () => !closing.value);
provideAppFeedback(feedback);
useEditTargetHandoff(feedback);
watch(
  applicationLogError,
  (message) => {
    if (message)
      feedback.warning({
        userMessage: '日志记录已停止；下次启动应用后恢复。',
        diagnostic: { code: 'log.recording_stopped', message, location: null },
      });
  },
  { immediate: true },
);
</script>
