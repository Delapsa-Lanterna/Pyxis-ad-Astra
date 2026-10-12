<template>
  <div v-if="records.length" class="immersive-source-notice">
    <strong><ImmersiveText text="来源与补全" font="heading" /></strong>
    <div v-for="record in records" :key="record.key">
      <span><ImmersiveText :text="record.source?.source === 'core' ? '原版来源' : '来源记录缺失'" /></span>
      <small><ImmersiveText :text="record.source?.path ?? writePath(record)" block /></small>
      <small v-if="record.referencedBy.length > 1"><ImmersiveText :text="'关联：' + record.referencedBy.join('、')" block /></small>
      <n-button v-if="perRecord && record.source?.source === 'core'" :disabled="saving" @click="$emit('create-overrides', [record.key])"
        >建立此来源的 Mod 覆盖</n-button
      >
      <n-button
        v-if="perRecord && record.value.state === 'missing' && record.target.kind === 'spec'"
        :disabled="saving"
        @click="$emit('create-source', record.key)"
        >补全此来源</n-button
      >
    </div>
    <n-button
      v-if="!perRecord && records.some((record) => record.source?.source === 'core')"
      :disabled="saving"
      @click="$emit('create-overrides')"
      >建立当前 Mod 覆盖</n-button
    >
    <span v-if="records.some((record) => record.value.state === 'missing')"
      ><ImmersiveText text="点击缺失字段可补全所属记录。" block
    /></span>
  </div>
</template>
<script setup lang="ts">
import type { JointEditRecord } from '@/shared/types';
import ImmersiveText from './ImmersiveText.vue';
withDefaults(defineProps<{ records: JointEditRecord[]; saving: boolean; perRecord?: boolean }>(), { perRecord: false });
defineEmits<{ 'create-overrides': [keys?: string[]]; 'create-source': [key: string] }>();
function writePath(record: JointEditRecord) {
  return record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path;
}
</script>
