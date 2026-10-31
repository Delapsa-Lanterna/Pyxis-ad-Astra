<template>
  <SchemaFieldRow :field="field" :path="fieldPath">
    <SchemaValueInput
      :field="field"
      :value="value"
      :runtime-context="runtimeContext"
      :input-key="inputKey"
      :field-path="fieldPath"
      :class="{ 'ui-text-muted': origin }"
      :title="origin ? '来自 ' + origin : undefined"
      @update="$emit('update', $event)"
    />
    <template v-if="runtimeContext?.composition" #actions>
      <n-button v-if="typeof value === 'string'" size="tiny" @click="runtimeContext.composition.apply(path, '')">设为空值</n-button>
      <n-button size="tiny" @click="runtimeContext.composition.apply(path, undefined)">使用引用值</n-button>
      <n-button v-if="Array.isArray(value)" size="tiny" @click="replaceList">替换整个列表</n-button>
    </template>
  </SchemaFieldRow>
</template>
<script setup lang="ts">
import SchemaFieldRow from './SchemaFieldRow.vue';
import SchemaValueInput from '@/app/components/schema/SchemaValueInput.vue';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { FieldSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import { computed } from 'vue';
import { compositionOrigin, compositionPath } from '@/domain/schema/json-composition';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
const props = defineProps<{
  field: FieldSchema;
  value: unknown;
  runtimeContext?: SchemaRuntimeContext | null;
  inputKey?: string;
  fieldPath?: string;
}>();
const feedback = useAppFeedback();
const path = computed(() => compositionPath(props.fieldPath ?? props.field.key));
const origin = computed(() => {
  const context = props.runtimeContext?.composition;
  const sources = context?.sources();
  return context && sources ? compositionOrigin(context.local(), sources, path.value) : null;
});
function replaceList() {
  feedback.confirmWarning({
    title: '替换整个列表？',
    content: '清空基础列表，并将当前列表作为本模组内容保存；后续基础列表新增项将由本模组列表替代。',
    actionText: '替换整个列表',
    onConfirm: () =>
      props.runtimeContext!.composition!.apply(path.value, [
        'core_clearArray',
        ...(props.value as import('@/shared/types').JsonValue[]).filter((value) => value !== 'core_clearArray'),
      ]),
  });
}
defineEmits<{ update: [update: SchemaFieldUpdate] }>();
</script>
