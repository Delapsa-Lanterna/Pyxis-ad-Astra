<template>
  <div class="json-page editor-page ui-layout-row ui-content-contained" :inert="actionsLocked">
    <JsonDocumentList
      v-if="definition.kind !== 'mod-info'"
      :definition="definition"
      :session-id="sessionId"
      :selected-id="selectedId"
      :items="items"
      :action-running="actionRunning"
      :hull-options="hullOptions"
      :load-hull-options="loadHullOptions"
      :create="create"
      :list-load-started-at="listLoadStartedAt"
      @select="select"
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
    />
    <div v-else class="json-placeholder ui-control-center ui-text-muted ui-layout-grid">
      <p>选择一个{{ definition.label }}以编辑</p>
    </div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useProjectStore } from '@/stores/project.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useCoreSchema } from '@/app/composables/use-core-schema';
import { useJsonEditorViewModel } from '@/app/composables/json-editor/use-json-editor-view-model';
import { JSON_DOCUMENT_DEFINITIONS } from '@/domain/json-editor/json-document-definitions';
import type { JsonEditorPageId } from '@/shared/types';
import JsonDocumentList from './JsonDocumentList.vue';
import JsonDocumentEditor from './JsonDocumentEditor.vue';
const props = defineProps<{ sessionId: string; modRoot: string; page: JsonEditorPageId }>();
const project = useProjectStore();
const workspace = useWorkspaceStore();
const definition = JSON_DOCUMENT_DEFINITIONS[props.page];
void useCoreSchema().loadCoreFields();
const {
  current,
  items,
  selectedId,
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
  modRoot: computed(() => props.modRoot),
  sessionId: computed(() => props.sessionId),
  manifest: computed(() => project.getManifest(props.modRoot) ?? null),
  active: computed(
    () => workspace.currentView === 'json-editor' && workspace.activeSessionId === props.sessionId && workspace.jsonPage === props.page,
  ),
});
</script>
