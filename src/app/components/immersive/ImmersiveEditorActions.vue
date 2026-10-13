<template>
  <div class="immersive-meta-actions">
    <n-button size="small" :disabled="!canUndo || saving" @click="$emit('undo')">撤销</n-button>
    <n-button size="small" :disabled="!canRedo || saving" @click="$emit('redo')">重做</n-button>
    <n-button size="small" :loading="saving" :disabled="!ready" type="primary" @click="$emit('save')">保存</n-button>
    <n-button size="small" @click="$emit('close')">关闭</n-button>
    <slot />
  </div>
</template>
<script setup lang="ts">
defineProps<{ canUndo: boolean; canRedo: boolean; saving: boolean; ready: boolean }>();
defineEmits<{ undo: []; redo: []; save: []; close: [] }>();
</script>
