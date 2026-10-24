<template>
  <div class="projectile-window ui-content-grid ui-content-surface">
    <EditorHeader
      :title="systemId"
      :path="path"
      :dirty="dirty"
      :saving="saving"
      :external-update-notice="externalUpdateNotice"
      @load-external="$emit('load-external')"
      ><template #actions
        ><n-button @click="$emit('close')">关闭</n-button
        ><n-button :disabled="!dirty || saving" @click="$emit('reset-requested')">重置</n-button
        ><n-button type="primary" :disabled="!canSave" :loading="saving" @click="$emit('save-requested')">保存</n-button></template
      ></EditorHeader
    >
    <EditorInspector class="projectile-body" title="战术系统检查器">
      <template #problems><SpecProblems /></template>
      <n-collapse v-model:expanded-names="view.expandedSections">
        <n-collapse-item
          v-for="section in view.sections"
          :key="section.name"
          class="schema-section"
          :title="section.title"
          :name="section.name"
        >
          <SchemaFieldRenderer
            v-for="field in section.fields"
            :key="field.key"
            :field="field"
            :value="document[field.key] ?? field.default"
            :runtime-context="schemaRuntime"
            @update="$event.kind === 'set' ? actions.setField(field.key, $event.value as JsonValue) : actions.removeField(field.key)"
          />
        </n-collapse-item>
      </n-collapse>
    </EditorInspector>
    <EditorFooter note="结构化 JSON 写回，完整保留业务字段。" />
  </div>
</template>
<script setup lang="ts">
import { inject } from 'vue';
import type { JsonValue } from '@/shared/types';
import NCollapse from '@/app/components/editors/common/EditorCollapse.vue';
import NCollapseItem from '@/app/components/editors/common/EditorCollapseItem.vue';
import SchemaFieldRenderer from '@/app/components/schema/SchemaFieldRenderer.vue';
import { specSchemaContext } from '@/app/composables/spec-editor/spec-schema-context';
import SpecProblems from '../SpecProblems.vue';
import EditorFooter from '@/app/components/editors/common/EditorFooter.vue';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import EditorInspector from '@/app/components/editors/common/EditorInspector.vue';
import {
  useSpecSystemEditorViewModel,
  type SpecSystemEditorProps,
  type SpecSystemEditorEvents,
} from '@/app/composables/spec-editor/system/use-spec-system-editor-view-model';
const props = defineProps<SpecSystemEditorProps>();
const emit = defineEmits<SpecSystemEditorEvents>();
const schemaRuntime = inject(specSchemaContext, null);
const { document, view, actions } = useSpecSystemEditorViewModel(props, emit);
</script>
