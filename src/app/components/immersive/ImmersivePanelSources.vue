<template>
  <ImmersiveSourceNotice
    v-if="render.mode === 'editable'"
    :records="render.editing.notices"
    :saving="render.editing.saving || render.editing.changing"
    :per-record="perRecord"
    @create-overrides="render.editing.override"
    @create-source="render.editing.create"
  />
</template>
<script setup lang="ts">
import type { ImmersiveRenderContext } from './immersive-render-context';
import ImmersiveSourceNotice from './ImmersiveSourceNotice.vue';
defineProps<{ render: ImmersiveRenderContext; perRecord?: boolean }>();
</script>
