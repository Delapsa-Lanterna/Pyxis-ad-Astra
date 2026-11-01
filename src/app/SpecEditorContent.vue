<template>
  <div
    class="app-frame editor-window-app editor-page editor-spec-page ui-content-contained ui-layout-grid ui-layout-clip ui-layout-stretch ui-text-normal"
    :data-theme="settings.theme"
    :inert="handoffLocked"
  >
    <div v-if="loading && !contentReady" class="editor-window-status ui-text-muted ui-layout-grid ui-layout-stretch">
      <strong class="editor-window-status-value ui-emphasis ui-text-normal">正在加载</strong>
      <span>{{ target?.id ?? '缺少目标 id' }}</span>
    </div>
    <div
      v-else-if="errorText && !contentReady"
      class="editor-window-status editor-window-error ui-text-muted ui-layout-grid ui-layout-stretch"
    >
      <strong class="editor-window-status-value editor-window-error-value ui-emphasis ui-text-normal">加载失败</strong>
      <span class="editor-window-error-label">{{ errorText }}</span>
      <n-button @click="reloadCurrentWindow">重试</n-button>
    </div>
    <SpecShipEditor
      v-else-if="shipEditorData && target"
      :mod-root="target.modRoot"
      :session-id="target.sessionId"
      :hull-id="target.id"
      :ship="shipEditorData.spec"
      :sprite-data="shipSpriteForEditor"
      :sprite-source-path="shipImages?.value.value?.resourceRefs[0]?.relPath ?? ''"
      :sprite-error="shipImages?.errorText.value || shipImages?.value.value?.diagnostic || ''"
      :edit-context="editContext"
      :path="editorData?.target.write.relPath"
      :dirty="draftDirty"
      :can-save="canSaveSpec"
      :saving="draftSaving"
      :external-update-notice="externalUpdateNotice"
      @close="closeWindow"
      @save-requested="saveEditorData()"
      @reset-requested="resetDraft"
      @draft-changed="updateEditorDraft($event)"
      @load-external="loadPendingExternalSpec"
    />
    <SpecWeaponEditor
      v-else-if="weaponEditorData && target"
      :mod-root="target.modRoot"
      :session-id="target.sessionId"
      :weapon-id="target.id"
      :weapon="weaponEditorData.spec"
      :sprite-data="weaponDependencies?.spriteData.value ?? {}"
      :edit-context="editContext"
      :path="editorData?.target.write.relPath"
      :dirty="draftDirty"
      :can-save="canSaveSpec"
      :saving="draftSaving"
      :external-update-notice="externalUpdateNotice"
      @close="closeWindow"
      @save-requested="saveEditorData()"
      @reset-requested="resetDraft"
      @draft-changed="updateEditorDraft($event)"
      @load-external="loadPendingExternalSpec"
      @edit-projectile="openProjectile"
      @preview="openPreview"
    />
    <SpecProjectileEditor
      v-else-if="projectileEditorData && target"
      :mod-root="target.modRoot"
      :session-id="target.sessionId"
      :projectile-id="target.id"
      :projectile="projectileEditorData.spec"
      :sprite-data="projectileImages?.value.value?.spriteData ?? {}"
      :resource-refs="projectileImages?.value.value?.resourceRefs ?? []"
      :sprite-loading="projectileImages?.loading.value ?? false"
      :sprite-error="projectileImages?.errorText.value || projectileImages?.value.value?.diagnostic || ''"
      :edit-context="editContext"
      :path="editorData?.target.write.relPath"
      :dirty="draftDirty"
      :can-save="canSaveSpec"
      :saving="draftSaving"
      :external-update-notice="externalUpdateNotice"
      @close="closeWindow"
      @save-requested="saveEditorData()"
      @reset-requested="resetDraft"
      @draft-changed="updateEditorDraft($event)"
      @load-external="loadPendingExternalSpec"
    />
    <SpecSystemEditor
      v-else-if="systemEditorData && target"
      :system-id="target.id"
      :system="systemEditorData.spec"
      :edit-context="editContext"
      :path="editorData?.target.write.relPath"
      :dirty="draftDirty"
      :can-save="canSaveSpec"
      :saving="draftSaving"
      :external-update-notice="externalUpdateNotice"
      @close="closeWindow"
      @save-requested="saveEditorData()"
      @reset-requested="resetDraft"
      @draft-changed="updateEditorDraft($event)"
      @load-external="loadPendingExternalSpec"
    />
    <div v-else class="editor-window-status editor-window-error ui-text-muted ui-layout-grid ui-layout-stretch">
      <strong class="editor-window-status-value editor-window-error-value ui-emphasis ui-text-normal">无法打开编辑器</strong>
      <span class="editor-window-error-label">{{ missingEditorText }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { provideFieldInputs } from '@/shared/runtime/field-inputs';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { computed, onMounted, onUnmounted, provide } from 'vue';
import { specSchemaContext } from '@/app/composables/spec-editor/spec-schema-context';
import { specProblemsKey } from '@/app/composables/spec-editor/use-spec-problems';
import { CONFIG_OPTION_SOURCES } from '@/domain/schema/schema-sources';
import SpecShipEditor from '@/app/components/spec-editor/ship/SpecShipEditor.vue';
import SpecWeaponEditor from '@/app/components/spec-editor/weapon/SpecWeaponEditor.vue';
import SpecProjectileEditor from '@/app/components/spec-editor/projectile/SpecProjectileEditor.vue';
import SpecSystemEditor from '@/app/components/spec-editor/system/SpecSystemEditor.vue';
import { useWindowCloseParticipant } from '@/app/composables/use-window-close-state';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';
import { openSpecProjectileEditorWindow } from '@/windows/spec-editor.window';
import { openWeaponFirePreviewWindow } from '@/windows/weapon-fire-preview.window';
import { useSettingsStore } from '@/stores/settings.store';
import { useCoreGraphics } from '@/app/composables/use-core-assets';
import { closeCurrentWindow, reloadCurrentWindow } from '@/windows/current.window';
import { specEditorDefinitions, useSpecEditorDependencies } from '@/app/composables/spec-editor-assembly';
import { useSpecEditorWindowViewModel } from '@/app/composables/spec-editor/use-spec-editor-window-view-model';
import { useWindowContext } from '@/windows/window-context.window';
import { useManagedWindowRequests } from '@/app/composables/use-managed-window-requests';

const context = useWindowContext('editor').value;
const { sessionId, modRoot, id } = context.identity;
const kind = context.identity.kind;
const { starsectorRoot } = useCoreGraphics();
const settings = useSettingsStore();
const feedback = useAppFeedback();

const windowModel = useSpecEditorWindowViewModel({ sessionId, modRoot, id, kind }, specEditorDefinitions[kind]);
provideFieldInputs(windowModel.inputs);
provide(specProblemsKey, windowModel.problems);
const {
  currentTarget: target,
  editorData,
  loading,
  contentReady,
  errorText,
  draftDirty,
  editContext,
  draftSaving,
  handoffLocked,
  canSaveSpec,
  externalUpdateNotice,
  missingEditorText,
  disposeEditorWindow,
  saveEditorData,
  resetDraft,
  updateEditorDraft,
  loadPendingExternalSpec,
} = windowModel;
provide(specSchemaContext, windowModel.schemaRuntimeContext);
const shipEditorData = computed(() => (editorData.value?.kind === 'ship' ? editorData.value : null));
const weaponEditorData = computed(() => (editorData.value?.kind === 'weapon' ? editorData.value : null));
const projectileEditorData = computed(() => (editorData.value?.kind === 'projectile' ? editorData.value : null));
const systemEditorData = computed(() => (editorData.value?.kind === 'system' ? editorData.value : null));
const { weapon: weaponDependencies, ship: shipImages, projectile: projectileImages } = useSpecEditorDependencies(windowModel, kind);
onUnmounted(
  windowModel.problems.register(() =>
    [
      shipImages?.errorText.value,
      shipImages?.value.value?.diagnostic,
      projectileImages?.errorText.value,
      projectileImages?.value.value?.diagnostic,
      ...(weaponDependencies?.notices.value ?? []),
    ]
      .filter((message): message is string => Boolean(message))
      .map((message) => ({ severity: 'warning' as const, code: 'spec.preview', path: message, message })),
  ),
);
const shipSpriteForEditor = computed(() =>
  typeof shipImages?.value.value?.spriteData === 'string' ? shipImages.value.value.spriteData : '',
);
useContextMenuScope({
  identity: () => JSON.stringify(target.value),
  canRefresh: () => Boolean(editorData.value) && !editorData.value?.isNew,
  refresh: () =>
    windowModel.refresh(
      [
        ...(shipImages?.value.value?.resourceRefs ?? []),
        ...(projectileImages?.value.value?.resourceRefs ?? []),
        ...(weaponDependencies?.resourceRefs.value ?? []),
        ...(starsectorRoot.value ? Object.values(CONFIG_OPTION_SOURCES).map((relPath) => ({ source: 'core' as const, relPath })) : []),
      ],
      Object.values(CONFIG_OPTION_SOURCES).map((path) => target.value!.modRoot + '/' + path),
    ),
});
useManagedWindowRequests(async () => {
  await windowModel.initializeEditorWindow();
  if (!(await windowModel.waitForSave())) throw new Error('所属保存尚未完成');
});
const closeParticipant = useWindowCloseParticipant({
  content: '当前 spec 有未保存修改，关闭后这些修改将丢失。',
  dirty: draftDirty,
  title: '放弃未保存编辑？',
});

function closeWindow() {
  void closeCurrentWindow().catch((error) => feedback.error(error, '关闭窗口失败'));
}

function openProjectile(projectileId: string) {
  if (!projectileId || !target.value) return;
  openSpecProjectileEditorWindow({
    modRoot: target.value.modRoot,
    id: projectileId,
    sessionId: target.value.sessionId,
    starsectorRoot: starsectorRoot.value,
  }).catch((error) => feedback.error(error, '打开弹体编辑器失败'));
}

function openPreview(weapon: import('@/shared/types/index').RowData) {
  if (!target.value) return;
  openWeaponFirePreviewWindow({
    modRoot: target.value.modRoot,
    id: target.value.id,
    sessionId: target.value.sessionId,
    source: { kind: 'draft', weapon },
  }).catch((error) => feedback.error(error, '打开开火预览失败'));
}

useWindowShortcuts({
  commands: {
    save: () => void saveEditorData(),
  },
});

onMounted(() => {
  void closeParticipant.install().catch((error) => feedback.error(error, '登记关闭保护失败'));
});

onUnmounted(() => {
  disposeEditorWindow();
});
</script>
