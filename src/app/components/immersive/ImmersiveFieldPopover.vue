<template>
  <div class="immersive-field-popover" @keydown.esc.stop.prevent="cancel" @keydown.enter="enter">
    <strong>{{ stat.label }}</strong>
    <p v-if="stat.formula" class="immersive-source-note">{{ stat.formula }}</p>
    <div v-for="(field, index) in stat.fields" :key="field.id">
      <ImmersiveFieldInput
        :field="field"
        :value="immersiveFieldValue(values, field)"
        :input-key="fieldKey(field)"
        :runtime-context="runtimeContext"
        :active="active"
        :autofocus="index === 0"
        @update="$emit('update', field, $event)"
      />
      <small class="immersive-source-note">{{ sourcePath(field.recordKey) }} · {{ field.schema.key }}</small>
    </div>
    <div class="immersive-field-actions">
      <n-button @mousedown.prevent @click="cancel">取消</n-button><n-button type="primary" @click="submit">提交</n-button>
    </div>
  </div>
</template>
<script setup lang="ts">
import type { ImmersiveField, ImmersiveStat } from '@/domain/immersive/fields';
import { immersiveFieldValue } from '@/domain/immersive/fields';
import type { JointValue, JointEditSnapshot } from '@/shared/types';
import type { SchemaFieldUpdate } from '@/domain/schema/schema.types';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import ImmersiveFieldInput from './ImmersiveFieldInput.vue';
const props = defineProps<{
  stat: ImmersiveStat;
  values: Record<string, JointValue>;
  snapshot: JointEditSnapshot;
  runtimeContext: SchemaRuntimeContext;
  active: boolean;
}>();
const emit = defineEmits<{ update: [field: ImmersiveField, update: SchemaFieldUpdate]; close: [] }>();
const inputs = useFieldInputs()!;
const feedback = useAppFeedback();
const prefix = JSON.stringify(['immersive', props.stat.id]);
const fieldKey = (field: ImmersiveField) => prefix + '/' + field.id;
function sourcePath(key: string) {
  const record = props.snapshot.records.find((record) => record.key === key)!;
  return record.source?.path ?? (record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path);
}
async function submit() {
  try {
    const accepted = await inputs.commit(prefix);
    if (accepted !== false) emit('close');
  } catch (error) {
    feedback.error(error);
  }
}
function cancel() {
  inputs.cancel(prefix);
  emit('close');
}
function enter(event: KeyboardEvent) {
  if (event.isComposing) return;
  if ((event.target as HTMLElement).tagName === 'TEXTAREA' && !event.ctrlKey) return;
  event.preventDefault();
  event.stopPropagation();
  void submit();
}
</script>
