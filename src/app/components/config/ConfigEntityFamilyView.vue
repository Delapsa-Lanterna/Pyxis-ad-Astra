<template>
  <div class="config-family-view editor-page ui-layout-row ui-content-contained" :inert="actionsLocked || editorRef?.handoffLocked">
    <ConfigEntityFamilyList v-bind="listProps" @select="selectFile" /><ConfigEntityFamilyEditor
      ref="editorRef"
      v-if="selectedId && editorFiles.some((file) => idOf(file) === selectedId)"
      :key="JSON.stringify([sessionId, modRoot, family.id])"
      :family="family"
      :selected-id="selectedId"
      :files="editorFiles"
      :mod-root="modRoot"
      :session-id="sessionId"
      :data-revision="dataRevision"
      :identity-handoff="identityHandoff"
      :save-file="saveFamilyEntity"
      :delete-entity="deleteFamilyEntity"
      :actions-locked="actionsLocked"
      :deleted-target="deletedTarget"
      :discard-deleted-target="discardDeletedTarget"
      @saved="onSaved"
    />
    <div v-else class="config-placeholder ui-control-center ui-text-muted ui-layout-grid">
      <p>选择一个{{ family.displayName }}以编辑</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, useTemplateRef } from 'vue';
import ConfigEntityFamilyEditor from '@/app/components/config/ConfigEntityFamilyEditor.vue';
import ConfigEntityFamilyList from '@/app/components/config/ConfigEntityFamilyList.vue';
import { useConfigFamilyViewModel } from '@/app/composables/config/use-config-family-view-model';
import { skinFamily, variantFamily } from '@/domain/config/config-entity-families';

const props = defineProps<{ familyId: 'variant' | 'skin' }>();

const family = computed(() => (props.familyId === 'variant' ? variantFamily : skinFamily));
const familyViewModel = useConfigFamilyViewModel(family.value);
const {
  selectedId,
  selectFile,
  actionsLocked,
  actionRunning,
  deletedTarget,
  discardDeletedTarget,
  editorFiles,
  identityHandoff,
  modRoot,
  sessionId,
  files,
  spriteRefs,
  hullNames,
  hullOptions,
  loadHullOptions,
  dataRevision,
  listLoadStartedAt,
  createFamilyEntity,
  deleteFamilyEntity,
  onSaved,
  saveFamilyEntity,
  idOf,
} = familyViewModel;
const editorRef = useTemplateRef('editorRef');
const listProps = computed(() => ({
  family: family.value,
  selectedId: selectedId.value,
  actionRunning: actionRunning.value,
  files: files.value,
  spriteRefs: spriteRefs.value,
  hullNames: hullNames.value,
  hullOptions: hullOptions.value,
  loadHullOptions: loadHullOptions,
  modRoot: modRoot.value,
  sessionId: sessionId.value,
  listLoadStartedAt: listLoadStartedAt.value,
  createEntity: createFamilyEntity,
}));
</script>
