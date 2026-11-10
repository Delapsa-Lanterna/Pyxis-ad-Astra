<template>
  <SchemaValueInput
    v-if="schema.root"
    :field="schema.root"
    :data-field-path="schema.root.key"
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
    <n-collapse-item v-if="showExtraFields" name="__extra" title="额外字段" class="schema-section">
      <template #header-extra
        ><small class="section-header-meta ui-text-muted">{{ extraKeys.length }} 项</small></template
      >
      <SchemaValueInput
        :field="{ key: '__extra', label: '额外字段', type: 'object', allowExtraFields: true, reservedKeys: extraKnownKeys }"
        :value="Object.fromEntries(extraKeys.map((key) => [key, extraModelValue[key]]))"
        @update="onExtraUpdate($event.kind === 'set' ? ($event.value as RowData) : {})"
      />
    </n-collapse-item>
  </EditorCollapse>
</template>
<script setup lang="ts">
import { computed, reactive, watch, nextTick } from 'vue';
import { compositionPath } from '@/domain/json-composition';
import { waitForEditorCollapse } from '@/app/components/editors/common/editor-collapse';
import type { FieldProblem } from '@/shared/types';
import { composeJson, editComposedJson } from '@/domain/json-composition';
import EditorCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import NCollapseItem from '@/app/components/editors/common/EditorCollapseItem.vue';
import { extraJsonFieldKeys } from '@/shared/lib/json-fields';
import type { RowData } from '@/shared/types';
import type { FieldEditorContext } from '@/domain/field-editor/field-editor-context';
import type { FileSchema, SectionSchema, SchemaFieldUpdate } from '@/domain/schema/schema.types';
import {
  getExtraFieldSource,
  getSchemaFieldKeys,
  getSchemaSections,
  isMultiSourceSchema,
  schemaSectionCollapseIdentity,
} from '@/domain/schema/schema-sections';
import { applySchemaFieldUpdate, getNestedValue, setNestedValue } from '@/domain/schema/schema-values';
import SchemaFieldRenderer from '@/app/components/field-editor/SchemaFieldRenderer.vue';
import SchemaValueInput from '@/app/components/field-editor/SchemaValueInput.vue';
import { useFieldEditMode } from '@/app/composables/field-editor/use-field-edit-mode';
import { useAppFeedback } from '@/app/composables/use-app-feedback';

const mode = useFieldEditMode();
const feedback = useAppFeedback();

const props = defineProps<{
  schema: FileSchema;
  runtimeContext?: FieldEditorContext | null;
}>();

const localValue = defineModel<RowData>({ required: true });
const modelValue = computed({
  get: () =>
    props.runtimeContext?.composition ? composeJson(localValue.value, props.runtimeContext.composition.sources()) : localValue.value,
  set: (next) => {
    const composition = props.runtimeContext?.composition;
    if (!composition) {
      localValue.value = next;
      return;
    }
    const edit = editComposedJson(localValue.value, modelValue.value, next, composition.sources(), composition.root);
    if (edit.notice) feedback.info(edit.notice);
    if (!edit.rejected) localValue.value = edit.value;
  },
});

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
const showExtraFields = computed(() => (mode.value === 'smart' ? props.schema.allowExtraFields === true : extraKeys.value.length > 0));

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

defineExpose({
  async locate(issue: FieldProblem, root: HTMLElement, current: () => boolean) {
    const path = compositionPath(issue.path);
    for (const section of sections.value)
      if (section.fields.some((field) => compositionPath(field.key).every((part, i) => path[i] === part)))
        collapsedSections.delete(section.id);
    await nextTick();
    for (;;) {
      if (!current()) return;
      const group = [...root.querySelectorAll<HTMLElement>('.n-collapse-item:not(.n-collapse-item--active)[data-field-path]')].find(
        (element) => compositionPath(element.dataset.fieldPath!).every((part, i) => path[i] === part),
      );
      if (!group) break;
      group.querySelector<HTMLElement>('.n-collapse-item__header-main')!.click();
      await nextTick();
    }
    await waitForEditorCollapse(root);
    if (!current()) return;
    const targets = [...root.querySelectorAll<HTMLElement>('[data-field-path]')];
    const target = targets
      .filter((element) => {
        const parts = compositionPath(element.dataset.fieldPath!);
        return parts.length <= path.length && parts.every((part, i) => path[i] === part);
      })
      .sort((left, right) => compositionPath(right.dataset.fieldPath!).length - compositionPath(left.dataset.fieldPath!).length)[0];
    target?.scrollIntoView({ block: 'nearest' });
    (target?.matches('input,textarea,button,[tabindex]')
      ? target
      : target?.querySelector<HTMLElement>('input,textarea,button,[tabindex]')
    )?.focus();
  },
});

function onFieldUpdate(key: string, update: SchemaFieldUpdate) {
  if (update.fileEdit && props.runtimeContext?.applyDocumentEdit && !props.runtimeContext.composition) {
    props.runtimeContext.applyDocumentEdit(update.fileEdit);
    return;
  }
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
