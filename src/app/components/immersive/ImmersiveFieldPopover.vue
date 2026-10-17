<template>
  <div class="immersive-field-popover ui-content-grid" @keydown.esc.stop.prevent="cancel" @keydown.enter="enter">
    <strong><ImmersiveText :text="stat.label" font="heading" /></strong>
    <p v-if="stat.formula" class="immersive-source-note ui-text-muted ui-text-wrap ui-text-reset">
      <ImmersiveText :text="stat.formula" block />
    </p>
    <div v-for="(field, index) in stat.fields" :key="field.id">
      <ImmersiveFieldInput
        :field="field"
        :value="immersiveFieldValue(values, field)"
        :input-key="fieldKey(field)"
        :runtime-context="runtimeContext"
        :active="active"
        :autofocus="index === 0"
        @update="pending.set(field.id, $event)"
      />
      <small class="immersive-source-note ui-text-muted ui-text-wrap ui-text-reset"
        ><ImmersiveText :text="sourcePath(field.recordKey) + ' · ' + field.schema.key" block
      /></small>
    </div>
    <div class="immersive-field-actions">
      <n-button @mousedown.prevent @click="cancel">取消</n-button><n-button type="primary" @click="submit">提交</n-button>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed, onScopeDispose, shallowReactive } from 'vue';
import type { ImmersiveField, ImmersiveStat, ImmersiveFieldChange } from '@/domain/immersive/fields';
import { immersiveFieldValue } from '@/domain/immersive/fields';
import type { JointValue, JointEditSnapshot } from '@/shared/types';
import type { SchemaFieldUpdate } from '@/domain/schema/schema.types';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import { useFieldInputs } from '@/shared/runtime/field-inputs';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import ImmersiveFieldInput from './ImmersiveFieldInput.vue';
import ImmersiveText from './ImmersiveText.vue';
const props = defineProps<{
  stat: ImmersiveStat;
  values: Record<string, JointValue>;
  snapshot: JointEditSnapshot;
  runtimeContext: SchemaRuntimeContext;
  active: boolean;
}>();
const emit = defineEmits<{ update: [changes: ImmersiveFieldChange[]]; submitted: []; close: [] }>();
const inputs = useFieldInputs()!;
const feedback = useAppFeedback();
const prefix = JSON.stringify(['immersive', props.stat.id]);
const pending = shallowReactive(new Map<string, SchemaFieldUpdate>());
onScopeDispose(
  inputs.register({
    key: prefix + '/submission',
    label: props.stat.label,
    dirty: computed(() => pending.size > 0),
    commit: () => null,
    focus: () => {},
    cancel: () => pending.clear(),
  }),
);
onScopeDispose(
  inputs.registerFinalizer(() => {
    const changes = props.stat.fields.flatMap((field) => {
      const update = pending.get(field.id);
      return update ? [{ field, update }] : [];
    });
    pending.clear();
    if (changes.length) emit('update', changes);
  }, prefix),
);
const fieldKey = (field: ImmersiveField) => prefix + '/' + field.id;
function sourcePath(key: string) {
  const record = props.snapshot.records.find((record) => record.key === key)!;
  return record.source?.path ?? (record.target.kind === 'spec' ? record.target.target.write.path : record.target.write.path);
}
async function submit() {
  try {
    const accepted = await inputs.commit(prefix);
    if (accepted !== false) {
      emit('submitted');
      emit('close');
    }
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
