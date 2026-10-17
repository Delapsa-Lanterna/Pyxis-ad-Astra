<template>
  <div class="immersive-actions ui-control-row ui-layout-stretch">
    <slot name="before" />
    <div class="immersive-buttons ui-control-row">
      <n-button size="small" :disabled="!canUndo || saving" @click="$emit('undo')">撤销</n-button
      ><n-button size="small" :disabled="!canRedo || saving" @click="$emit('redo')">重做</n-button
      ><n-button size="small" type="primary" :loading="saving" :disabled="!ready" @click="$emit('save')">保存</n-button
      ><n-button size="small" @click="$emit('close')">关闭</n-button>
    </div>
    <span v-if="$slots.default" class="ui-status ui-text-muted ui-layout-inline ui-layout-center" :class="{ dirty, saving }"
      ><i class="ui-status-indicator" /><slot
    /></span>
  </div>
</template>
<script setup lang="ts">
defineProps<{ canUndo: boolean; canRedo: boolean; saving: boolean; ready: boolean; dirty?: boolean }>();
defineEmits<{ undo: []; redo: []; save: []; close: [] }>();
</script>
