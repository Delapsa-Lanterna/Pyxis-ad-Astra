<template>
  <div class="faction-editor-page ui-content-column ui-content-surface-muted" :inert="actionsLocked || handoffLocked">
    <ConfigTargetNotice
      label="势力"
      :deleted-target="deletedTarget"
      :actions-locked="actionsLocked"
      :discard-deleted-target="discardDeletedTarget"
    />
    <header class="faction-editor-header ui-control-between">
      <h2 class="faction-editor-header-title ui-text-normal ui-text-reset">{{ displayName }}</h2>
      <div class="config-editor-actions ui-layout-row ui-layout-center">
        <n-button v-if="hasPendingExternalData" size="small" secondary type="warning" @click="loadPendingExternalData">
          载入外部版本
        </n-button>
        <n-button size="small" secondary type="error" @click="confirmDeleteFaction">删除</n-button>
        <n-button type="primary" size="small" :loading="saving" @click="save">保存</n-button>
      </div>
    </header>
    <div v-if="externalUpdateNotice" class="config-external-update-note ui-text-small ui-layout-row ui-layout-center">
      {{ externalUpdateNotice }}
    </div>

    <!-- Logo/Crest preview -->
    <div v-if="logoSrc || crestSrc" class="faction-previews ui-layout-grid ui-control-border ui-content-surface">
      <div v-if="logoSrc" class="faction-preview-item faction-preview-logo ui-text-muted ui-layout-grid ui-layout-shrink">
        <span class="faction-preview-item-label ui-text-soft ui-text-small">Logo</span>
        <img :src="logoSrc" class="faction-full-preview ui-image ui-layout-stretch ui-control-border" />
      </div>
      <div v-if="crestSrc" class="faction-preview-item faction-preview-crest ui-text-muted ui-layout-grid ui-layout-shrink">
        <span class="faction-preview-item-label ui-text-soft ui-text-small">Crest</span>
        <img :src="crestSrc" class="faction-full-preview ui-image ui-layout-stretch ui-control-border" />
      </div>
    </div>

    <!-- Schema-driven form -->
    <SchemaFormRenderer v-if="schema" :schema="schema" v-model="draftData" :runtime-context="props.schemaRuntimeContext" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, toRef } from 'vue';
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
  draftData,
  externalUpdateNotice,
  hasPendingExternalData,
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
  feedback.confirmDanger({
    title: '删除势力',
    content: `确定要删除势力 "${deleteId}" 吗？`,
    actionText: '删除',
    onConfirm: async () => {
      await deleteFactionTarget(deleteSessionId, deleteModRoot, deleteId);
    },
  });
}

async function deleteFactionTarget(deleteSessionId: string, deleteModRoot: string, deleteId: string) {
  try {
    await props.deleteFaction(deleteSessionId, deleteModRoot, deleteId, true);
  } catch (error) {
    feedback.error(error, '删除势力失败');
    return false;
  }
  return true;
}

const saveCommand = useSaveCommandStore();
onMounted(() => saveCommand.registerActiveSaveHandler(save));
onUnmounted(() => saveCommand.unregisterActiveSaveHandler(save));
</script>
