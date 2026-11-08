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
      :path="document.target.value!.entity?.write.relPath ?? document.paths.value"
      :dirty="document.dirty.value"
      :saving="document.saving.value"
      :external-update-notice="document.externalUpdateNotice.value"
      @load-external="document.loadPendingExternal"
    >
      <template #actions
        ><n-button v-if="definition.file?.immersiveKind" @click="openImmersive">沉浸式编辑器</n-button
        ><n-button v-if="definition.kind === 'skin'" :disabled="!canNavigateBaseHull" @click="navigateToBaseHull">跳转到船体</n-button
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
    <EditorProblems :issues="document.problems.issues.value" @locate="locateProblem" />
    <div class="editor-fields ui-content-scroll">
      <p v-if="schemaRuntimeContext.composition" class="ui-text-muted ui-text-small ui-text-reset">
        {{ schemaRuntimeContext.partial ? '待组合文件' : '完整定义文件' }}
      </p>
      <div v-show="Object.values(previews).some(Boolean)" class="panel-card ui-layout-row ui-control-border ui-content-surface">
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
      <SchemaFormRenderer ref="form" :schema="document.schema.value" v-model="draft" :runtime-context="schemaRuntimeContext" />
    </div>
  </section>
</template>
<script setup lang="ts">
import { dialogBody, dialogFiles } from '@/shared/ui/dialog-content';
import { computed, h, ref, useTemplateRef } from 'vue';
import EditorProblems from '@/shared/ui/EditorProblems.vue';
import type { FieldProblem } from '@/shared/types';
import { miscConfigDefinition } from '@/domain/misc-config';
import { provideFieldInputs } from '@/shared/runtime/field-inputs';
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useJsonDocumentView } from '@/app/composables/json-editor/use-json-document-view';
import type { JsonDocumentSession } from '@/app/composables/json-editor/use-json-document-session';
import type { JsonEditorHost } from '@/app/composables/json-editor/json-editor-context';
import { jsonDocumentContent, type JsonDocumentDefinition, type JsonDocumentRecord } from '@/domain/json-editor/json-document-definitions';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';
import SchemaFormRenderer from '@/app/components/field-editor/SchemaFormRenderer.vue';
import JsonTargetNotice from './JsonTargetNotice.vue';
import JsonDeleteSourceDialog from './JsonDeleteSourceDialog.vue';
const props = defineProps<{
  definition: JsonDocumentDefinition;
  locateBaseHull: JsonEditorHost['locateBaseHull'];
  document: JsonDocumentSession;
  actionsLocked: boolean;
  deletedTarget: boolean;
  discardDeletedTarget: () => void | Promise<void>;
  remove: (record: JsonDocumentRecord, deleteSource: boolean) => Promise<boolean>;
}>();
const feedback = useAppFeedback();
const commands = useSaveCommandStore();
const fileWaiting = computed(() => useProjectSyncStore().isWaiting(props.document.target.value?.modRoot));
const { canNavigateBaseHull, navigateToBaseHull, previews, schemaRuntimeContext, openImmersive } = useJsonDocumentView(
  props.document,
  props.definition,
  props.locateBaseHull,
);
const draft = props.document.draftValue;
const form = useTemplateRef('form');
async function locateProblem(issue: FieldProblem) {
  const view = form.value!;
  const target = props.document.targetKey.value,
    admitted = props.document.inputs.captureContext();
  const current = () => form.value === view && admitted() && target === props.document.targetKey.value;
  try {
    if (issue.code === 'field.input_invalid') return await props.document.inputs.focus(issue.path);
    if ((await props.document.inputs.commit()) === false) return;
    if (!current()) return;
    const path = issue.location?.field;
    const wrapped = !props.document.schema.value.root && ['faction', 'mod-info', 'misc-config'].includes(props.definition.kind);
    await view.locate(path ? { ...issue, path: wrapped ? `file.${path}` : path } : issue, view.$el.parentElement, current);
  } catch (error) {
    feedback.error(error, '定位 JSON 字段失败');
  }
}
const title = computed(() => {
  if (props.definition.kind === 'misc-config') return miscConfigDefinition(props.document.target.value!.id).label;
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
async function confirmDelete() {
  const record = props.document.record.value,
    target = record.target,
    removeSource = ref(false);
  const missing = Boolean(props.definition.file && props.document.sourceMissing.value);
  const indexed = !missing && (target.kind === 'mission' || (target.kind === 'faction' && target.entity!.linkedRecord?.kind === 'index'));
  const path = target.entity?.write.path ?? target.modRoot + '/' + miscConfigDefinition(target.id).path;
  const label = props.definition.label,
    item = target.kind === 'misc-config' ? '配置文件' : target.kind === 'skin' ? '皮肤' : label + (target.kind === 'faction' ? '文件' : '');
  const removeAction = indexed ? (target.kind === 'mission' ? '目录' : '文件') : item;
  const choice = await feedback.choose({
    title: missing ? '放弃这份文档的编辑？' : indexed ? '移除这个' + label + '的登记？' : '删除这个' + item + '？',
    content: () =>
      indexed
        ? h(JsonDeleteSourceDialog, {
            id: target.id,
            label,
            path,
            indexPath:
              target.entity?.linkedRecord?.kind === 'index'
                ? target.modRoot + '/' + target.entity.linkedRecord.path
                : target.modRoot + '/data/missions/mission_list.csv',
            checked: removeSource.value,
            'onUpdate:checked': (value: boolean) => {
              removeSource.value = value;
            },
          })
        : dialogBody(
            missing
              ? '这份文档的源文件已缺失。继续后放弃保留的草稿与历史，并移除当前编辑目标。'
              : `删除 ${label} ${target.id} 的文件，并放弃当前草稿和草稿历史。`,
            dialogFiles([path]),
            ...(!missing && props.document.composition.value?.layers.length
              ? [
                  '删除后，这个路径继续采用基础来源提供的内容。',
                  ...props.document.composition.value.layers.map((layer) => dialogFiles([layer.source.path])),
                ]
              : []),
          ),
    choices: [
      {
        get label() {
          return missing
            ? '放弃编辑'
            : indexed
              ? '移除登记' + (removeSource.value ? '并删除' + removeAction : '')
              : '删除' + (target.kind === 'faction' ? '文件' : item);
        },
        value: 'delete',
        type: 'warning',
      },
    ],
    cancelText: missing ? '继续编辑' : '取消',
  });
  if (choice === 'delete') await props.remove(record, removeSource.value);
}
</script>
