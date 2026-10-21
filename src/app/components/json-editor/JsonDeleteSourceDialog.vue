<template>
  <div>
    <p>确定要从列表移除 "{{ id }}"，并放弃该文档的草稿与历史吗？</p>
    <n-checkbox v-model:checked="checked">{{ label }}</n-checkbox>
  </div>
</template>
<script setup lang="ts">
defineProps<{ id: string; label: string }>();
const checked = defineModel<boolean>('checked', { required: true });
</script>
