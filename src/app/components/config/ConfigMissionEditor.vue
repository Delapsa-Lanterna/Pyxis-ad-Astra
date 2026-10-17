<template>
  <main
    v-if="schema"
    class="mission-editor editor-page ui-layout-row ui-content-contained ui-content-surface-muted"
    :inert="actionsLocked || handoffLocked"
  >
    <slot name="list" />
    <div class="editor-content ui-content-column ui-content-contained">
      <ConfigTargetNotice
        label="战役"
        :deleted-target="deletedTarget"
        :actions-locked="actionsLocked"
        :discard-deleted-target="discardDeletedTarget"
      />
      <EditorHeader
        :title="displayName"
        :path="paths"
        :dirty="dirty"
        :saving="saving"
        :external-update-notice="externalUpdateNotice"
        @load-external="loadPendingExternalData"
        ><template #actions
          ><n-button secondary type="error" @click="confirmDeleteMission">删除</n-button
          ><n-button :disabled="!dirty || saving" @click="reset">重置</n-button
          ><n-button type="primary" :disabled="!dirty" :loading="saving" @click="save">保存</n-button></template
        ></EditorHeader
      >
      <div class="editor-fields ui-content-scroll">
        <div v-if="iconSrc" class="panel-card ui-layout-row ui-control-border ui-content-surface">
          <div class="config-image-preview ui-text-muted ui-layout-grid ui-layout-shrink">
            <span class="ui-text-soft ui-text-small">图标</span>
            <img class="config-image-preview-image ui-image ui-layout-stretch ui-control-border" :src="iconSrc" :alt="displayName" />
          </div>
        </div>
        <SchemaFormRenderer :schema="schema" v-model="draftData" :runtime-context="schemaRuntimeContext" />
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { NCheckbox } from 'naive-ui/es/checkbox';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';

import { h, ref, computed, onMounted, onUnmounted, toRef } from 'vue';
import type { ConfigMissionEditorData, RowData } from '@/shared/types';
import SchemaFormRenderer from '@/app/components/schema/SchemaFormRenderer.vue';
import ConfigTargetNotice from '@/app/components/config/ConfigTargetNotice.vue';
import { getSchema } from '@/domain/schema/schema-registry';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { createSchemaRuntimeContext } from '@/app/composables/use-schema-runtime-context';
import type { FileSchema } from '@/domain/schema/schema.types';
import { useConfigMissionEditorViewModel } from '@/app/composables/config/use-config-mission-editor-view-model';
import { useSaveCommandStore } from '@/stores/save-command.store';

const props = defineProps<{
  missionId: string;
  actionsLocked: boolean;
  deletedTarget: boolean;
  discardDeletedTarget: () => void | Promise<void>;
  identityHandoff: import('@/shared/types').ConfigIdentityHandoff<ConfigMissionEditorData> | null;
  modRoot: string | null;
  sessionId: string | null;
  editorReloadToken: number;
  iconRefreshToken: number;
  queryMissionEditorData: (sessionId: string, id: string) => Promise<ConfigMissionEditorData | null>;
  queryMissionIcon: (sessionId: string, id: string, draft: RowData) => Promise<string>;
  saveMission: (
    sessionId: string,
    modRoot: string,
    previousId: string,
    localMission: RowData,
    schema: FileSchema,
    baseVersions: import('@/shared/types').FileVersion[],
  ) => Promise<import('@/shared/types').ConfigSaveIdentity | null>;
  deleteMission: (sessionId: string, modRoot: string, id: string, deleteDirectory: boolean) => Promise<boolean>;
}>();
const emit = defineEmits<{ saved: [missionId: string | null, saved?: import('@/shared/types').ConfigSaveIdentity] }>();

const feedback = useAppFeedback();

const modRoot = computed(() => props.modRoot);
const sessionId = computed(() => props.sessionId);
const schema = computed(() => getSchema('mission'));
const schemaRuntimeContext = computed(() =>
  props.modRoot && props.sessionId ? { ...createSchemaRuntimeContext(props.modRoot, props.sessionId), missionId: props.missionId } : null,
);
const {
  dirty,
  reset,
  paths,
  draftData,
  displayName,
  externalUpdateNotice,
  iconSrc,
  loadPendingExternalData,
  loadedMissionId,
  save,
  saving,
  handoffLocked,
} = useConfigMissionEditorViewModel({
  editorReloadToken: toRef(props, 'editorReloadToken'),
  iconRefreshToken: toRef(props, 'iconRefreshToken'),
  missionId: toRef(props, 'missionId'),
  modRoot,
  onSaved: (missionId, saved) => emit('saved', missionId, saved),
  queryMissionEditorData: props.queryMissionEditorData,
  queryMissionIcon: props.queryMissionIcon,
  saveMission: props.saveMission,
  schema,
  sessionId,
  actionsLocked: toRef(props, 'actionsLocked'),
  identityHandoff: toRef(props, 'identityHandoff'),
});

function confirmDeleteMission() {
  const id = loadedMissionId.value ?? props.missionId;
  const deleteModRoot = modRoot.value;
  const deleteSessionId = sessionId.value;
  if (!deleteModRoot || !deleteSessionId || !id) return;
  const removeSource = ref(false);
  feedback.confirmDanger({
    title: '删除战役',
    content: () =>
      h('div', [
        h('p', `确定要从列表移除 "${id}" 吗？`),
        h(
          NCheckbox,
          {
            checked: removeSource.value,
            'onUpdate:checked': (checked: boolean) => {
              removeSource.value = checked;
            },
          },
          { default: () => '同时删除战役目录' },
        ),
      ]),
    actionText: '删除',
    onConfirm: async () => {
      await deleteMissionTarget(deleteSessionId, deleteModRoot, id, removeSource.value);
    },
  });
}

async function deleteMissionTarget(deleteSessionId: string, deleteModRoot: string, id: string, removeSource: boolean) {
  try {
    await props.deleteMission(deleteSessionId, deleteModRoot, id, removeSource);
  } catch (error) {
    feedback.error(error, '删除战役失败');
    return false;
  }
  return true;
}

const saveCommand = useSaveCommandStore();
onMounted(() => saveCommand.registerActiveSaveHandler(save));
onUnmounted(() => saveCommand.unregisterActiveSaveHandler(save));
</script>
