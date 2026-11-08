<template>
  <div class="json-page editor-page ui-layout-row ui-content-contained" :inert="actionsLocked">
    <JsonDocumentList
      v-if="definition.kind !== 'mod-info'"
      :definition="definition"
      :session-id="target.sessionId"
      :selected-id="selectedId"
      :items="items"
      :search="search"
      :set-search="setSearch"
      :load-failed="listFailed"
      :loading="listLoading"
      :load-error="listErrorText"
      :selecting-id="selectingId"
      :action-running="actionRunning"
      :hull-options="hullOptions"
      :load-hull-options="loadHullOptions"
      :create="create"
      :list-load-started-at="listLoadStartedAt"
      @select="select"
      @retry="retryList()"
    />
    <JsonDocumentEditor
      v-if="current"
      :key="current.viewId"
      :definition="definition"
      :document="current"
      :actions-locked="actionsLocked"
      :deleted-target="deletedTarget"
      :discard-deleted-target="discardDeletedTarget"
      :remove="remove"
      :locate-base-hull="host.locateBaseHull"
    />
    <section v-else-if="selectedFile" class="editor-content empty-state ui-layout-grid ui-content-scroll ui-content-surface-muted">
      <div class="ui-field-stack ui-layout-shrink">
        <h1 class="page-title">{{ selectedFile.label }}</h1>
        <p class="page-path ui-text-muted ui-text-reset ui-text-wrap">{{ selectedFile.path }}</p>
        <p class="page-description">{{ selectedFile.description }}</p>
        <template v-if="fileError">
          <p class="ui-text-reset">{{ fileErrorText }}</p>
          <div class="action-group ui-control-center">
            <n-button @click="retryFile()">重试</n-button><n-button @click="repairFile">修复文件</n-button>
          </div>
        </template>
        <p v-else-if="fileLoading" class="ui-text-reset">正在读取 {{ selectedFile.filename }}…</p>
        <template v-else>
          <p class="ui-text-reset">当前 Mod 尚未创建 {{ selectedFile.filename }}。</p>
          <div class="action-group ui-control-center">
            <n-button type="primary" :loading="actionRunning" :disabled="listFailed" @click="create(selectedFile.kind, '')"
              >创建文件</n-button
            >
          </div>
        </template>
      </div>
    </section>
    <div v-else class="json-placeholder ui-control-center ui-text-muted ui-layout-grid">
      <p>选择一个{{ definition.label }}以编辑</p>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { appendFileReferenceLocation, extractFileReferenceFromError, formatError } from '@/shared/lib/errors';
import { useProjectStore } from '@/stores/project.store';
import { useCoreSchema } from '@/app/composables/use-core-schema';
import { useJsonEditorViewModel } from '@/app/composables/json-editor/use-json-editor-view-model';
import { JSON_DOCUMENT_DEFINITIONS } from '@/domain/json-editor/json-document-definitions';
import type { JsonEditorHost, JsonEditorPageTarget } from '@/app/composables/json-editor/json-editor-context';
import JsonDocumentList from './JsonDocumentList.vue';
import JsonDocumentEditor from './JsonDocumentEditor.vue';
const props = defineProps<{ target: JsonEditorPageTarget; host: JsonEditorHost }>();
const project = useProjectStore();
const definition = JSON_DOCUMENT_DEFINITIONS[props.target.page];
void useCoreSchema().loadCoreFields();
const {
  current,
  selectedFile,
  fileError,
  fileLoading,
  retryFile,
  repairFile,
  items,
  search,
  setSearch,
  listFailed,
  listLoading,
  listErrorText,
  retryList,
  selectedId,
  selectingId,
  select,
  actionsLocked,
  actionRunning,
  deletedTarget,
  discardDeletedTarget,
  hullOptions,
  loadHullOptions,
  listLoadStartedAt,
  create,
  remove,
} = useJsonEditorViewModel(definition, {
  modRoot: computed(() => props.target.modRoot),
  sessionId: computed(() => props.target.sessionId),
  manifest: computed(() => project.getManifest(props.target.modRoot) ?? null),
  entityLocation: props.host.entityLocation,
  completeEntityLocation: props.host.completeEntityLocation,
  active: computed(() => {
    const current = props.host.pageTarget.value;
    return current?.sessionId === props.target.sessionId && current.modRoot === props.target.modRoot && current.page === props.target.page;
  }),
});
const fileErrorText = computed(() =>
  appendFileReferenceLocation(formatError(fileError.value), extractFileReferenceFromError(fileError.value)),
);
</script>
