<template>
  <SchemaValueInput
    v-if="schema.root"
    :field="schema.root"
    :value="getNestedValue(modelValue, schema.root.key)"
    :runtime-context="runtimeContext"
    @update="onFieldUpdate(schema.root!.key, $event)"
  />
  <EditorCollapse v-else :expanded-names="expandedNames" @update:expanded-names="updateExpandedNames">
    <template v-for="section in sections" :key="section.id">
      <n-collapse-item :name="section.id" :title="section.label" class="schema-section">
        <template #header-extra
          ><small class="section-header-meta ui-text-muted">{{ section.fields.length }} 项</small></template
        >
        <SchemaFieldRenderer
          v-for="field in section.fields"
          :key="field.key"
          :field="field"
          :value="getNestedValue(modelValue, field.key)"
          :runtime-context="runtimeContext"
          @update="onFieldUpdate(field.key, $event)"
        />
      </n-collapse-item>
    </template>
    <n-collapse-item v-if="extraKeys.length" name="__extra" title="额外字段" class="schema-section">
      <template #header-extra
        ><small class="section-header-meta ui-text-muted">{{ extraKeys.length }} 项</small></template
      >
      <SchemaValueInput
        :field="{ key: '__extra', label: '额外字段', type: 'object', reservedKeys: extraKnownKeys }"
        :value="Object.fromEntries(extraKeys.map((key) => [key, extraModelValue[key]]))"
        @update="onExtraUpdate($event.kind === 'set' ? ($event.value as RowData) : {})"
      />
    </n-collapse-item>
  </EditorCollapse>
</template>
<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import EditorCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import NCollapseItem from '@/app/components/editors/common/EditorCollapseItem.vue';
import { extraJsonFieldKeys } from '@/shared/lib/json-fields';
import type { RowData } from '@/shared/types';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { FileSchema, SectionSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import {
  getExtraFieldSource,
  getSchemaFieldKeys,
  getSchemaSections,
  isMultiSourceSchema,
  schemaSectionCollapseIdentity,
} from '@/domain/schema/schema-sections';
import { applySchemaFieldUpdate, getNestedValue, setNestedValue } from '@/domain/schema/schema-values';
import SchemaFieldRenderer from '@/app/components/schema/SchemaFieldRenderer.vue';
import SchemaValueInput from '@/app/components/schema/SchemaValueInput.vue';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';

useInputEditMode();

const props = defineProps<{
  schema: FileSchema;
  runtimeContext?: SchemaRuntimeContext | null;
}>();

const modelValue = defineModel<RowData>({ required: true });

const sections = computed<SectionSchema[]>(() => getSchemaSections(props.schema));

const schemaKeys = computed<string[]>(() => getSchemaFieldKeys(props.schema));

const extraSource = computed(() => getExtraFieldSource(props.schema));

const extraModelValue = computed<RowData>(() => {
  if (!isMultiSourceSchema(props.schema)) return modelValue.value;
  const sourceId = extraSource.value;
  if (!sourceId) return {};
  const sourceValue = modelValue.value[sourceId];
  return sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue) ? (sourceValue as RowData) : {};
});

const extraKnownKeys = computed<string[]>(() => {
  if (!isMultiSourceSchema(props.schema)) return schemaKeys.value;
  const sourceId = extraSource.value;
  if (!sourceId) return [];
  return schemaKeys.value.filter((key) => key.startsWith(`${sourceId}.`)).map((key) => key.slice(sourceId.length + 1));
});

const extraKeys = computed<string[]>(() => extraJsonFieldKeys(extraModelValue.value, extraKnownKeys.value));

const collapsedSections = reactive(new Set<string>());

function syncCollapsedSections() {
  collapsedSections.clear();
  for (const section of sections.value) {
    if (section.collapsed) {
      collapsedSections.add(section.id);
    }
  }
}

watch(() => schemaSectionCollapseIdentity(props.schema), syncCollapsedSections, {
  immediate: true,
});

const expandedNames = computed(() =>
  [...sections.value.map((section) => section.id), '__extra'].filter((id) => !collapsedSections.has(id)),
);
function updateExpandedNames(names: (string | number)[]) {
  collapsedSections.clear();
  for (const id of [...sections.value.map((section) => section.id), '__extra']) if (!names.includes(id)) collapsedSections.add(id);
}

function onFieldUpdate(key: string, update: SchemaFieldUpdate) {
  const updated = applySchemaFieldUpdate(modelValue.value, key, update);
  modelValue.value = updated;
}

function onExtraUpdate(value: RowData) {
  value = {
    ...Object.fromEntries(
      extraKnownKeys.value.filter((key) => Object.hasOwn(extraModelValue.value, key)).map((key) => [key, extraModelValue.value[key]!]),
    ),
    ...value,
  };
  if (!isMultiSourceSchema(props.schema)) {
    modelValue.value = value;
    return;
  }
  const sourceId = extraSource.value;
  if (!sourceId) return;
  modelValue.value = setNestedValue(modelValue.value, sourceId, value);
}
</script>
