<template>
  <ImmersiveSourceNotice
    v-if="render.mode === 'editable'"
    :records="render.editing.notices"
    :saving="render.editing.saving || render.editing.changing"
    :per-record="perRecord"
    @create-overrides="render.editing.override"
    @create-source="render.editing.create"
  />
  <details v-else class="immersive-readonly-sources" @toggle="toggle">
    <summary><ImmersiveText text="来源与诊断" font="heading" /></summary>
    <div v-if="expanded">
      <p v-for="record in render.records" :key="record.key" class="immersive-source-note">
        <ImmersiveText :text="sourceText(record)" font="caption" block />
      </p>
    </div>
  </details>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import type { JointEditRecord } from '@/shared/types';
import type { ImmersiveRenderContext } from './immersive-render-context';
import ImmersiveSourceNotice from './ImmersiveSourceNotice.vue';
import ImmersiveText from './ImmersiveText.vue';
defineProps<{ render: ImmersiveRenderContext; perRecord?: boolean }>();
const expanded = ref(false);
function toggle(event: Event) {
  expanded.value = (event.target as HTMLDetailsElement).open;
}
function sourceText(record: JointEditRecord) {
  const location = record.source ?? (record.target.kind === 'spec' ? record.target.target.write : record.target.write);
  return `${record.value.state === 'missing' ? '来源记录缺失' : location.source === 'core' ? '原版来源' : 'Mod 来源'}：${location.path}`;
}
</script>
