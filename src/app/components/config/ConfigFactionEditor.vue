<template>
  <section class="editor-content ui-content-column ui-content-contained ui-content-surface-muted">
    <ConfigTargetNotice
      label="势力"
      :deleted-target="deletedTarget"
      :actions-locked="actionsLocked"
      :discard-deleted-target="discardDeletedTarget"
    /><EditorHeader
      :title="displayName"
      :path="paths"
      :dirty="dirty"
      :saving="saving"
      :external-update-notice="externalUpdateNotice"
      @load-external="loadPendingExternalData"
      ><template #actions
        ><n-button secondary type="error" @click="confirmDeleteFaction">删除</n-button
        ><n-button :disabled="!dirty || saving" @click="reset">重置</n-button
        ><n-button type="primary" :disabled="!dirty" :loading="saving" @click="save">保存</n-button></template
      ></EditorHeader
    >
    <div class="editor-fields ui-content-scroll">
      <!-- Logo/Crest preview -->
      <div v-if="logoSrc || crestSrc" class="panel-card ui-layout-row ui-control-border ui-content-surface">
        <div v-if="logoSrc" class="config-image-preview ui-text-muted ui-layout-grid ui-layout-shrink">
          <span class="ui-text-soft ui-text-small">Logo</span>
          <img :src="logoSrc" class="config-image-preview-image ui-image ui-layout-stretch ui-control-border" />
        </div>
        <div v-if="crestSrc" class="config-image-preview ui-text-muted ui-layout-grid ui-layout-shrink">
          <span class="ui-text-soft ui-text-small">Crest</span>
          <img :src="crestSrc" class="config-image-preview-image ui-image ui-layout-stretch ui-control-border" />
        </div>
      </div>

      <!-- Schema-driven form -->
      <SchemaFormRenderer v-if="schema" :schema="schema" v-model="draftData" :runtime-context="props.schemaRuntimeContext" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { NCheckbox } from 'naive-ui/es/checkbox';
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';

import { h, ref, computed, onMounted, onUnmounted, toRef } from 'vue';
import type { RowData } from '@/shared/types';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { FileSchema } from '@/domain/schema/schema.types';
import SchemaFormRenderer from '@/app/components/schema/SchemaFormRenderer.vue';
import ConfigTargetNotice from '@/app/components/config/ConfigTargetNotice.vue';
import { useCoreSchema } from '@/app/composables/use-core-assets';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useConfigFactionEditorViewModel } from '@/app/composables/config/use-config-faction-editor-view-model';
import { useSaveCommandStore } from '@/stores/save-command.store';

const props = defineProps<{
  identityHandoff: import('@/shared/types').ConfigIdentityHandoff<import('@/domain/config/config-records').ConfigFactionRecord> | null;
  factionId: string;
  actionsLocked: boolean;
  deletedTarget: boolean;
  discardDeletedTarget: () => void | Promise<void>;
  dataRevision: number;
  previewRevision: number;
  factions: Record<string, RowData>;
  factionVersions: Record<string, import('@/shared/types').FileVersion[]>;
  modRoot: string | null;
  sessionId: string | null;
  queryPreviewImages: (sessionId: string, factionId: string, draft: RowData) => Promise<{ logoSrc: string; crestSrc: string }>;
  schemaRuntimeContext: SchemaRuntimeContext | null;
  saveFaction: (
    sessionId: string,
    modRoot: string,
    previousId: string,
    local: RowData,
    schema: FileSchema,
    baseVersions: import('@/shared/types').FileVersion[],
  ) => Promise<import('@/shared/types').ConfigSaveIdentity | null>;
  deleteFaction: (sessionId: string, modRoot: string, id: string, deleteFile: boolean) => Promise<boolean>;
}>();
const emit = defineEmits<{ saved: [factionId: string | null, saved?: import('@/shared/types').ConfigSaveIdentity] }>();

const { getMergedSchema, loadCoreFields } = useCoreSchema();
loadCoreFields();

const schema = computed(() => getMergedSchema('faction'));
const feedback = useAppFeedback();
const {
  crestSrc,
  displayName,
  dirty,
  reset,
  paths,
  draftData,
  externalUpdateNotice,
  loadPendingExternalData,
  logoSrc,
  save,
  saving,
  handoffLocked,
} = useConfigFactionEditorViewModel({
  dataRevision: toRef(props, 'dataRevision'),
  factionId: toRef(props, 'factionId'),
  factions: toRef(props, 'factions'),
  factionVersions: toRef(props, 'factionVersions'),
  identityHandoff: toRef(props, 'identityHandoff'),
  modRoot: toRef(props, 'modRoot'),
  onSaved: (factionId, saved) => emit('saved', factionId, saved),
  previewRevision: toRef(props, 'previewRevision'),
  queryPreviewImages: props.queryPreviewImages,
  saveFaction: props.saveFaction,
  schema,
  sessionId: toRef(props, 'sessionId'),
  actionsLocked: toRef(props, 'actionsLocked'),
});

function confirmDeleteFaction() {
  const deleteModRoot = props.modRoot;
  const deleteSessionId = props.sessionId;
  const deleteId = props.factionId;
  if (!deleteModRoot || !deleteSessionId || !deleteId) return;
  const removeSource = ref(false);
  feedback.confirmDanger({
    title: '删除势力',
    content: () =>
      h('div', [
        h('p', `确定要从列表移除 "${deleteId}" 吗？`),
        h(
          NCheckbox,
          {
            checked: removeSource.value,
            'onUpdate:checked': (checked: boolean) => {
              removeSource.value = checked;
            },
          },
          { default: () => '同时删除势力文件' },
        ),
      ]),
    actionText: '删除',
    onConfirm: async () => {
      await deleteFactionTarget(deleteSessionId, deleteModRoot, deleteId, removeSource.value);
    },
  });
}

async function deleteFactionTarget(deleteSessionId: string, deleteModRoot: string, deleteId: string, removeSource: boolean) {
  try {
    await props.deleteFaction(deleteSessionId, deleteModRoot, deleteId, removeSource);
  } catch (error) {
    feedback.error(error, '删除势力失败');
    return false;
  }
  return true;
}

defineExpose({ handoffLocked });

const saveCommand = useSaveCommandStore();
onMounted(() => saveCommand.registerActiveSaveHandler(save));
onUnmounted(() => saveCommand.unregisterActiveSaveHandler(save));
</script>
