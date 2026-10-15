<template>
  <ImmersiveSourceNotice
    v-if="render.mode === 'editable'"
    :records="render.editing.notices"
    :saving="render.editing.saving || render.editing.changing"
    :per-record="perRecord"
    @create-overrides="render.editing.override"
    @create-source="$emit('create-source', $event)"
  />
</template>
<script setup lang="ts">
import type { ImmersiveRenderContext } from './immersive-render-context';
import ImmersiveSourceNotice from './ImmersiveSourceNotice.vue';
defineProps<{ render: ImmersiveRenderContext; perRecord?: boolean }>();
defineEmits<{ 'create-source': [key: string] }>();
</script>
