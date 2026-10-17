<template>
  <div class="mission-view editor-page ui-layout-row ui-content-contained" :inert="actionsLocked || editorRef?.handoffLocked">
    <ConfigMissionList v-bind="listProps" @select="selectMission" /><ConfigMissionEditor
      ref="editorRef"
      v-if="selectedMission"
      :key="JSON.stringify([sessionId, modRoot])"
      :mission-id="selectedMission"
      :mod-root="modRoot"
      :session-id="sessionId"
      :editor-reload-token="missionEditorReloadToken"
      :icon-refresh-token="missionIconRefreshToken"
      :query-mission-editor-data="queryMissionEditorData"
      :query-mission-icon="queryMissionIcon"
      :save-mission="saveMission"
      :delete-mission="deleteMission"
      :actions-locked="actionsLocked"
      :deleted-target="deletedTarget"
      :discard-deleted-target="discardDeletedTarget"
      :identity-handoff="identityHandoff"
      @saved="handleSaved"
    />
    <div v-else class="config-placeholder ui-control-center ui-text-muted ui-layout-grid"><p>选择一个战役以编辑</p></div>
  </div>
</template>

<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import ConfigMissionList from '@/app/components/config/ConfigMissionList.vue';
import ConfigMissionEditor from '@/app/components/config/ConfigMissionEditor.vue';
import { useConfigMissionViewModel } from '@/app/composables/config/use-config-mission-view-model';

const {
  selectedMission,
  identityHandoff,
  selectMission,
  actionsLocked,
  actionRunning,
  deletedTarget,
  discardDeletedTarget,
  missionEditorReloadToken,
  missionIconRefreshToken,
  listLoadStartedAt,
  missionItems,
  modRoot,
  sessionId,
  handleSaved,
  createMission,
  deleteMission,
  queryMissionEditorData,
  queryMissionIcon,
  saveMission,
} = useConfigMissionViewModel();
const editorRef = useTemplateRef('editorRef');
const listProps = computed(() => ({
  selectedId: selectedMission.value,
  actionRunning: actionRunning.value,
  missions: missionItems.value,
  modRoot: modRoot.value,
  sessionId: sessionId.value,
  listLoadStartedAt: listLoadStartedAt.value,
  createMission: createMission,
}));
</script>
