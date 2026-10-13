<template>
  <div class="variant-source-creation" @keydown.esc.stop.prevent="$emit('close')">
    <ImmersiveText :text="'补全装配 ' + sourceId" font="picker-title" block />
    <ImmersiveFieldPopover
      :stat="stat"
      :values="vm.joint.draftValue.value"
      :snapshot="vm.snapshot.value!"
      :runtime-context="vm.runtimeContext.value"
      :active="true"
      @update="vm.updateFields"
      @submitted="vm.save"
      @close="$emit('close')"
    />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import type { ImmersiveStat } from '@/domain/immersive/fields';
import type { useImmersiveEditorViewModel } from '@/app/composables/use-immersive-editor-view-model';
import ImmersiveFieldPopover from './ImmersiveFieldPopover.vue';
import ImmersiveText from './ImmersiveText.vue';
const props = defineProps<{ recordKey: string; vm: ReturnType<typeof useImmersiveEditorViewModel> }>();
defineEmits<{ close: [] }>();
const sourceId = computed(() => {
  const record = props.vm.snapshot.value!.records.find((item) => item.key === props.recordKey)!;
  return record.target.kind === 'spec' ? record.target.target.id : '';
});
const stat = computed<ImmersiveStat>(() => ({
  id: props.recordKey + '/create',
  label: '选择关联舰体／Skin',
  display: '',
  fields: [
    {
      id: props.recordKey + '/create/hullId',
      recordKey: props.recordKey,
      schema: { key: 'hullId', label: '舰体／Skin', type: 'enum', source: 'hull:ids', required: true },
    },
  ],
}));
</script>
