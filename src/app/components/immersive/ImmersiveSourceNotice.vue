<template>
  <div v-if="records.length" class="immersive-source-notice">
    <strong><ImmersiveText text="来源与补全" font="heading" /></strong>
    <div v-for="record in records" :key="record.key">
      <span><ImmersiveText :text="record.source?.source === 'core' ? '原版来源' : '来源记录缺失'" /></span>
      <small><ImmersiveText :text="record.source?.path ?? writePath(record)" block /></small>
      <small v-if="record.referencedBy.length > 1"><ImmersiveText :text="'关联：' + record.referencedBy.join('、')" block /></small>
    </div>
    <n-button v-if="records.some((record) => record.source?.source === 'core')" :disabled="saving" @click="$emit('create-overrides')"
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
defineProps<{ records: JointEditRecord[]; saving: boolean }>();
defineEmits<{ 'create-overrides': [] }>();
function writePath(record: JointEditRecord) {
  return record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path;
}
</script>
