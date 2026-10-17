<template>
  <div class="config-factions-layout editor-page ui-layout-row ui-content-contained" :inert="actionsLocked || editorRef?.handoffLocked">
    <ConfigFactionList v-bind="listProps" @select="selectFaction" /><ConfigFactionEditor
      ref="editorRef"
      v-if="selectedFaction && editorFactions[selectedFaction]"
      :key="JSON.stringify([sessionId, modRoot])"
      :faction-id="selectedFaction"
      :faction-versions="editorFactionVersions"
      :identity-handoff="identityHandoff"
      :data-revision="factionDataRevision"
      :preview-revision="factionPreviewRevision"
      :factions="editorFactions"
      :mod-root="modRoot"
      :session-id="sessionId"
      :query-preview-images="queryFactionPreviewImages"
      :schema-runtime-context="schemaRuntimeContext"
      :save-faction="saveFaction"
      :delete-faction="deleteFaction"
      :actions-locked="actionsLocked"
      :deleted-target="deletedTarget"
      :discard-deleted-target="discardDeletedTarget"
      @saved="onSaved"
    />
    <div v-else class="config-placeholder ui-control-center ui-text-muted ui-layout-grid"><p>选择一个势力以编辑</p></div>
  </div>
</template>

<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import ConfigFactionList from '@/app/components/config/ConfigFactionList.vue';
import ConfigFactionEditor from '@/app/components/config/ConfigFactionEditor.vue';
import { useConfigFactionViewModel } from '@/app/composables/config/use-config-faction-view-model';

const {
  selectedFaction,
  selectFaction,
  actionsLocked,
  actionRunning,
  deletedTarget,
  discardDeletedTarget,
  editorFactions,
  editorFactionVersions,
  identityHandoff,
  factionDataRevision,
  factionPreviewRevision,
  listLoadStartedAt,
  factions,
  factionIconRefs,
  modRoot,
  sessionId,
  schemaRuntimeContext,
  createFaction,
  deleteFaction,
  onSaved,
  queryFactionPreviewImages,
  saveFaction,
} = useConfigFactionViewModel();
const editorRef = useTemplateRef('editorRef');
const listProps = computed(() => ({
  selectedId: selectedFaction.value,
  actionRunning: actionRunning.value,
  factions: factions.value,
  factionIconRefs: factionIconRefs.value,
  modRoot: modRoot.value,
  sessionId: sessionId.value,
  listLoadStartedAt: listLoadStartedAt.value,
  createFaction: createFaction,
}));
</script>
