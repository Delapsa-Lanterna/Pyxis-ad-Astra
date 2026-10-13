<template>
  <ImmersiveStatRow
    v-if="render.mode === 'editable'"
    :stat="stat"
    :editable="!render.editing.changing && stat.fields.every(render.editing.editable)"
    :active="render.editing.activeStat === stat.id"
    :values="render.editing.values"
    :snapshot="render.editing.snapshot"
    :runtime-context="render.editing.runtimeContext"
    @toggle="render.editing.toggle(stat.id, $event)"
    @dismiss="render.editing.dismiss"
    @update="render.editing.update"
  />
  <ImmersiveStatRow v-else :stat="stat" :editable="false" :active="false" />
</template>
<script setup lang="ts">
import type { ImmersiveStat } from '@/domain/immersive/fields';
import type { ImmersiveRenderContext } from './immersive-render-context';
import ImmersiveStatRow from './ImmersiveStatRow.vue';
defineProps<{ stat: ImmersiveStat; render: ImmersiveRenderContext }>();
</script>
