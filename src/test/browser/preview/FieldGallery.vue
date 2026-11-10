<template>
  <section class="page-content browser-gallery" data-gallery="fields">
    <div class="browser-gallery-actions">
      <label
        >编辑方式
        <select
          aria-label="字段编辑方式"
          :value="settings.editMode"
          @change="settings.setEditMode(($event.target as HTMLSelectElement).value as 'plain' | 'smart')"
        >
          <option value="smart">增强</option>
          <option value="plain">普通</option>
        </select></label
      >
      <label
        >输入状态
        <select aria-label="字段状态" v-model="state" @change="reset">
          <option v-for="(label, key) in states" :key="key" :value="key">{{ label }}</option>
        </select></label
      >
      <button @click="commit">提交输入</button><button @pointerdown.prevent @click="cancel">取消输入</button
      ><button @click="reset">恢复样本</button>
      <output role="status">{{ result }}</output>
    </div>
    <div v-for="field in fields" :key="field.key" class="browser-gallery-item" :data-case="field.key">
      <SchemaFieldRenderer :field="field" :value="value[field.key]" :runtime-context="context" @update="updateField(field.key, $event)" />
    </div>
    <pre data-gallery-value>{{ JSON.stringify(value, null, 2) }}</pre>
  </section>
</template>
<script setup lang="ts">
import { computed, onScopeDispose, ref, shallowRef } from 'vue';
import SchemaFieldRenderer from '@/app/components/field-editor/SchemaFieldRenderer.vue';
import { useSettingsStore } from '@/stores/settings.store';
import { provideFieldInputs } from '@/shared/runtime/field-inputs';
import { applySchemaFieldUpdate, prepareSchemaAtPath } from '@/domain/schema/schema-values';
import { prepareValue } from '@/domain/schema/game-number';
import { createJsonDocument } from '@/domain/json-document';
import type { SchemaFieldUpdate, FileSchema } from '@/domain/schema/schema.types';
import type { RowData } from '@/shared/types';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { queryBuiltInWeaponSlotOptions } from '@/services/hull-reference.service';
import { querySourceOptionCatalog } from '@/services/source-catalog.service';
import { fieldValues, galleryFields } from './fields';
import { browserModel } from '../runtime/commands';
import '../browser.css';
const settings = useSettingsStore(),
  inputs = provideFieldInputs(),
  feedback = useAppFeedback();
onScopeDispose(inputs.release);
const owner = shallowRef(createJsonDocument(null, { value: prepareValue(fieldValues()).value }));
const revision = ref(0);
const schema: FileSchema = { id: 'gallery', sections: [{ id: 'fields', label: 'Fields', fields: galleryFields }] };
const value = computed({
  get: () => {
    void revision.value;
    return owner.value.projection as RowData;
  },
  set: (value: RowData) => {
    owner.value.update(value, (value, path) => prepareSchemaAtPath(value, path, schema));
    revision.value++;
  },
});
const state = ref('normal'),
  result = ref('尚未提交');
const states = { normal: '正常', required: '必填', readonly: '只读', empty: '空值', long: '长文本' };
const fields = computed(() =>
  galleryFields.map((field) => ({
    ...field,
    editable: state.value !== 'readonly',
    required: state.value === 'required' || field.required,
  })),
);
const model = browserModel();
const context = computed(() => ({
  document: owner.value,
  applyDocumentEdit: (edit: Parameters<typeof owner.value.apply>[0]) => {
    owner.value.apply(edit);
    revision.value++;
  },
  sessionId: model.sessionId,
  modRoot: model.manifest.modRoot,
  querySourceOptions: (source: string, signal?: AbortSignal) =>
    source.startsWith('hull:')
      ? queryBuiltInWeaponSlotOptions(
          model.sessionId,
          model.fieldHullId ?? model.graph('ship').root.id,
          signal,
          source === 'hull:moduleSlots' ? 'moduleSlots' : 'weaponSlots',
        )
      : querySourceOptionCatalog(model.sessionId, source, signal),
}));
function updateField(key: string, update: SchemaFieldUpdate) {
  if (update.fileEdit) context.value.applyDocumentEdit(update.fileEdit);
  else value.value = applySchemaFieldUpdate(value.value, key, update);
}
function reset() {
  inputs.cancel();
  const initial = fieldValues();
  if (state.value === 'empty' || state.value === 'required') for (const key of ['string', 'text', 'integer', 'float']) delete initial[key];
  if (state.value === 'long') initial.text = '用于核对长内容换行与滚动。'.repeat(30);
  owner.value = createJsonDocument(null, { value: prepareValue(initial).value });
  result.value = '样本已恢复';
}
function cancel() {
  inputs.cancel();
  result.value = '输入已取消';
}
async function commit() {
  try {
    await inputs.commit(undefined, true);
    result.value = '输入已提交';
  } catch (error) {
    result.value = '输入校验未通过';
    feedback.error(error, '字段校验');
  }
}
</script>
