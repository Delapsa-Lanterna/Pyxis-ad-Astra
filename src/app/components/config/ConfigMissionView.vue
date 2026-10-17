<template>
  <div class="mission-view editor-page ui-content-column ui-content-contained">
    <ConfigMissionEditor
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
    >
      <template #list>
        <ConfigMissionList v-bind="listProps" @select="selectMission" />
      </template>
    </ConfigMissionEditor>
    <div v-else class="editor-content ui-content-contained ui-layout-row">
      <ConfigMissionList v-bind="listProps" @select="selectMission" />
      <div class="config-placeholder ui-control-center ui-text-muted ui-layout-grid">
        <p>选择一个战役以编辑</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
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
  missionIconRefs,
  modRoot,
  sessionId,
  handleSaved,
  createMission,
  deleteMission,
  queryMissionEditorData,
  queryMissionIcon,
  saveMission,
} = useConfigMissionViewModel();
const listProps = computed(() => ({
  selectedId: selectedMission.value,
  actionRunning: actionRunning.value,
  missions: missionItems.value,
  missionIconRefs: missionIconRefs.value,
  modRoot: modRoot.value,
  sessionId: sessionId.value,
  listLoadStartedAt: listLoadStartedAt.value,
  createMission: createMission,
  deleteMission: deleteMission,
}));
</script>
