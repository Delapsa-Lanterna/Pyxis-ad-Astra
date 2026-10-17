<template>
  <section v-if="selectedFile && schema" class="editor-content ui-content-column ui-content-contained ui-content-surface-muted">
    <ConfigTargetNotice
      :label="family.displayName"
      :deleted-target="deletedTarget"
      :actions-locked="actionsLocked"
      :discard-deleted-target="discardDeletedTarget"
    /><EditorHeader
      :title="String(draftData.displayName || draftData.hullName || selectedId)"
      :path="paths"
      :dirty="dirty"
      :saving="saving"
      :external-update-notice="externalUpdateNotice"
      @load-external="loadPendingExternalData"
      ><template #actions
        ><n-button v-if="family.immersiveKind" @click="openImmersive">沉浸式编辑器</n-button
        ><n-button secondary type="error" @click="confirmDelete">删除</n-button
        ><n-button :disabled="!dirty || saving" @click="reset">重置</n-button
        ><n-button type="primary" :disabled="!dirty" :loading="saving" @click="save">保存</n-button></template
      ></EditorHeader
    >
    <div class="editor-fields ui-content-scroll">
      <SchemaFormRenderer :schema="schema" v-model="draftData" :runtime-context="schemaRuntimeContext" />
    </div>
  </section>
</template>

<script setup lang="ts">
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';

import { computed, onMounted, onUnmounted, toRef } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import type { RowData, SavedConfig, ConfigIdentityHandoff } from '@/shared/types';
import SchemaFormRenderer from '@/app/components/schema/SchemaFormRenderer.vue';
import ConfigTargetNotice from '@/app/components/config/ConfigTargetNotice.vue';
import { getSchema } from '@/domain/schema/schema-registry';
import { useConfigFamilyEditorViewModel } from '@/app/composables/config/use-config-family-editor-view-model';
import { useSaveCommandStore } from '@/stores/save-command.store';
import type { ConfigEntityFamilyDefinition, ConfigFamilyFile } from '@/domain/config/config-entity-families';
import { familyFileId } from '@/domain/config/config-entity-families';

const props = defineProps<{
  family: ConfigEntityFamilyDefinition;
  selectedId: string;
  actionsLocked: boolean;
  deletedTarget: boolean;
  discardDeletedTarget: () => void | Promise<void>;
  files: ConfigFamilyFile[];
  modRoot: string | null;
  sessionId: string | null;
  dataRevision: number;
  identityHandoff: ConfigIdentityHandoff<ConfigFamilyFile> | null;
  saveFile: (sessionId: string, modRoot: string, current: ConfigFamilyFile, data: RowData) => Promise<SavedConfig<ConfigFamilyFile> | null>;
  deleteEntity: (sessionId: string, modRoot: string, id: string, relPath: string) => Promise<boolean>;
}>();
const emit = defineEmits<{ saved: [id: string | null, file?: ConfigFamilyFile] }>();

const feedback = useAppFeedback();

const schema = computed(() => getSchema(props.family.schemaId));
const files = computed(() => [...props.files]);
const {
  dirty,
  reset,
  paths,
  draftData,
  externalUpdateNotice,
  loadPendingExternalData,
  save,
  openImmersive,
  saving,
  handoffLocked,
  selectedFile,
  schemaRuntimeContext,
} = useConfigFamilyEditorViewModel({
  family: props.family,
  dataRevision: toRef(props, 'dataRevision'),
  modRoot: toRef(props, 'modRoot'),
  onSaved: (id, file) => emit('saved', id, file),
  saveFile: props.saveFile,
  sessionId: toRef(props, 'sessionId'),
  selectedId: toRef(props, 'selectedId'),
  files,
  identityHandoff: toRef(props, 'identityHandoff'),
  actionsLocked: toRef(props, 'actionsLocked'),
});

function fileId(file: ConfigFamilyFile): string {
  return familyFileId(file);
}

function confirmDelete() {
  const current = selectedFile.value;
  const deleteModRoot = props.modRoot;
  const deleteSessionId = props.sessionId;
  if (!current || !deleteModRoot || !deleteSessionId) return;
  const currentId = fileId(current);
  feedback.confirmDanger({
    title: `删除${props.family.displayName}`,
    content: `确定要删除${props.family.displayName} "${currentId}" 吗？`,
    actionText: '删除',
    onConfirm: async () => {
      await deleteEntityTarget(deleteSessionId, deleteModRoot, currentId, String(current.relPath ?? ''));
    },
  });
}

async function deleteEntityTarget(deleteSessionId: string, deleteModRoot: string, currentId: string, relPath: string) {
  try {
    if (!(await props.deleteEntity(deleteSessionId, deleteModRoot, currentId, relPath))) return false;
  } catch (error) {
    feedback.error(error, `删除${props.family.displayName}失败`);
    return false;
  }
  return true;
}

defineExpose({ handoffLocked });

const saveCommand = useSaveCommandStore();
onMounted(() => saveCommand.registerActiveSaveHandler(save));
onUnmounted(() => saveCommand.unregisterActiveSaveHandler(save));
</script>
