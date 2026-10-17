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
const closing = useAppLifecycleAssembly();
const feedback = createWindowFeedback(useMessage(), useDialog(), () => !closing.value);
provideAppFeedback(feedback);
useEditTargetHandoff(feedback);
</script>
