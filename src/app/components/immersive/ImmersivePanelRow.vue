<template>
  <ImmersiveStatRow
    :stat="stat"
    :editable="!vm.referenceChanging.value && stat.fields.every(vm.editable)"
    :active="vm.selectedStatId.value === stat.id"
    :values="vm.joint.draftValue.value"
    :snapshot="vm.snapshot.value!"
    :runtime-context="vm.runtimeContext.value"
    @toggle="vm.toggleStat(stat.id, $event)"
    @dismiss="vm.dismissStat"
    @update="vm.updateFields"
  />
</template>
<script setup lang="ts">
import type { ImmersiveStat } from '@/domain/immersive/fields';
import type { useImmersiveEditorViewModel } from '@/app/composables/use-immersive-editor-view-model';
import ImmersiveStatRow from './ImmersiveStatRow.vue';
defineProps<{ stat: ImmersiveStat; vm: ReturnType<typeof useImmersiveEditorViewModel> }>();
</script>
