<template>
  <section class="editor-content ui-content-column ui-content-contained ui-content-surface-muted" :inert="document.handoffLocked.value">
    <div v-if="definition.kind === 'mod-info' && document.sourceMissing.value" class="ui-notice">
      <span>来源已删除</span><n-button size="small" @click="document.recreateSources">重新创建来源</n-button>
    </div>
    <JsonTargetNotice
      v-else
      :label="definition.label"
      :deleted-target="deletedTarget || document.sourceMissing.value"
      :recreate-sources="document.recreateSources"
      :actions-locked="actionsLocked"
      :discard-deleted-target="discardDeletedTarget"
    />
    <EditorHeader
      :title="title"
      :path="document.paths.value"
      :dirty="document.dirty.value"
      :saving="document.saving.value"
      :external-update-notice="document.externalUpdateNotice.value"
      @load-external="document.loadPendingExternal"
    >
      <template #actions
        ><n-button v-if="definition.file?.immersiveKind" @click="openImmersive">沉浸式编辑器</n-button
        ><n-button v-if="definition.kind === 'skin'" :disabled="!canNavigateHull" @click="navigateToHull">跳转到船体</n-button
        ><n-button v-if="definition.kind !== 'mod-info'" secondary type="error" @click="confirmDelete">删除</n-button
        ><n-button :disabled="!document.canUndo.value" @click="replay('undo')">撤销</n-button
        ><n-button :disabled="!document.canRedo.value" @click="replay('redo')">重做</n-button
        ><n-button
          type="primary"
          :disabled="!document.dirty.value || fileWaiting"
          :loading="document.saving.value"
          @click="commands.dispatchSaveCommand"
          >保存</n-button
        ></template
      >
    </EditorHeader>
    <div class="editor-fields ui-content-scroll">
      <p v-if="document.composition.value" class="ui-text-muted">{{ compositionNotice }}</p>
      <div v-if="Object.values(previews).some(Boolean)" class="panel-card ui-layout-row ui-control-border ui-content-surface">
        <div
          v-for="(src, label) in previews"
          :key="label"
          v-show="src"
          class="json-image-preview ui-text-muted ui-layout-grid ui-layout-shrink"
        >
          <span class="ui-text-soft ui-text-small">{{ label }}</span
          ><n-image
            :src="src"
            :alt="title"
            class="ui-layout-stretch"
            width="100%"
            :img-props="{ class: 'json-image-preview-image ui-image ui-control-border' }"
          />
        </div>
      </div>
      <SchemaFormRenderer :schema="document.schema.value" v-model="draft" :runtime-context="schemaRuntimeContext" />
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, h, ref } from 'vue';
import { composeJson } from '@/domain/schema/json-composition';
import { miscConfigFile } from '@/domain/json-editor/misc-config-files';
import { provideFieldInputs } from '@/shared/runtime/field-inputs';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useJsonDocumentView } from '@/app/composables/json-editor/use-json-document-view';
import type { JsonDocumentSession } from '@/app/composables/json-editor/use-json-document-session';
import { jsonDocumentContent, type JsonDocumentDefinition, type JsonDocumentRecord } from '@/domain/json-editor/json-document-definitions';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import SchemaFormRenderer from '@/app/components/schema/SchemaFormRenderer.vue';
import JsonTargetNotice from './JsonTargetNotice.vue';
import JsonDeleteSourceDialog from './JsonDeleteSourceDialog.vue';
const props = defineProps<{
  definition: JsonDocumentDefinition;
  document: JsonDocumentSession;
  actionsLocked: boolean;
  deletedTarget: boolean;
  discardDeletedTarget: () => void | Promise<void>;
  remove: (record: JsonDocumentRecord, deleteSource: boolean) => Promise<boolean>;
}>();
const feedback = useAppFeedback();
const commands = useSaveCommandStore();
const fileWaiting = computed(() => useProjectSyncStore().isWaiting(props.document.target.value?.modRoot));
const { canNavigateHull, navigateToHull, previews, schemaRuntimeContext, openImmersive } = useJsonDocumentView(
  props.document,
  props.definition,
);
const draft = props.document.draftValue;
const compositionNotice = computed(() => {
  const sources = props.document.composition.value;
  const effective = composeJson(jsonDocumentContent(props.definition.kind, draft.value), sources);
  const id = effective.id ?? effective.hullId ?? effective.skinHullId;
  return `${props.document.target.value?.entity?.write.relPath.split('/').at(-1) ?? props.document.target.value?.id} · ${id ? '目标：' + id : '当前仅预览本模组内容，基础定义尚未提供'}`;
});
const title = computed(() => {
  if (props.definition.kind === 'misc-config') return miscConfigFile(props.document.target.value!.id).label;
  const data = jsonDocumentContent(props.definition.kind, draft.value);
  return String(data.displayName || data.hullName || data.title || data.name || props.document.target.value!.id);
});
provideFieldInputs(props.document.inputs);
async function replay(direction: 'undo' | 'redo') {
  try {
    await props.document[direction]();
  } catch (error) {
    feedback.error(error, 'JSON 历史操作失败');
  }
}
function confirmDelete() {
  const record = props.document.record.value;
  const removeSource = ref(false);
  const indexed = props.definition.kind === 'faction' || props.definition.kind === 'mission';
  const missingFileSource = Boolean(props.definition.file && props.document.sourceMissing.value);
  feedback.confirmDanger({
    title: '删除' + props.definition.label,
    content: indexed
      ? () =>
          h(JsonDeleteSourceDialog, {
            id: record.target.id,
            label: props.definition.kind === 'faction' ? '同时删除势力文件' : '同时删除战役目录',
            checked: removeSource.value,
            'onUpdate:checked': (value: boolean) => {
              removeSource.value = value;
            },
          })
      : missingFileSource
        ? '源文件已不存在，确定放弃' + props.definition.label + ' "' + record.target.id + '" 的草稿并移除当前编辑目标吗？'
        : '确定要删除' + props.definition.label + ' "' + record.target.id + '"，并放弃该文档的草稿与历史吗？',
    actionText: '删除',
    onConfirm: async () => {
      await props.remove(record, removeSource.value);
    },
  });
}
</script>
