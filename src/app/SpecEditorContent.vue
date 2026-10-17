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
      :projectile-options="weaponDependencies?.projectileOptions.value ?? []"
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
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { computed, onMounted, onUnmounted } from 'vue';
import SpecShipEditor from '@/app/components/spec-editor/ship/SpecShipEditor.vue';
import SpecWeaponEditor from '@/app/components/spec-editor/weapon/SpecWeaponEditor.vue';
import SpecProjectileEditor from '@/app/components/spec-editor/projectile/SpecProjectileEditor.vue';
import SpecSystemEditor from '@/app/components/spec-editor/system/SpecSystemEditor.vue';
import { useDirtyWindowCloseGuard } from '@/app/composables/use-dirty-window-close-guard';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { openSpecProjectileEditorWindow } from '@/windows/spec-editor.window';
import { openWeaponFirePreviewWindow } from '@/windows/weapon-fire-preview.window';
import { useSettingsStore } from '@/stores/settings.store';
import { closeCurrentWindow, reloadCurrentWindow } from '@/windows/current.window';
import { specEditorDefinition, useSpecEditorDependencies } from '@/app/composables/spec-editor-assembly';
import { useSpecEditorWindowViewModel } from '@/app/composables/spec-editor/use-spec-editor-window-view-model';
import { useWindowContext } from '@/windows/window-context.window';
import { useManagedWindowRequests } from '@/app/composables/use-managed-window-requests';

const context = useWindowContext('editor').value;
const { sessionId, modRoot, id } = context.identity;
const kind = context.identity.kind;
const starsectorRoot = context.input.starsectorRoot;
const settings = useSettingsStore();
const feedback = useAppFeedback();

const windowModel = useSpecEditorWindowViewModel({ sessionId, modRoot, id, kind }, specEditorDefinition(kind));
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
const shipEditorData = computed(() => (editorData.value?.kind === 'ship' ? editorData.value : null));
const weaponEditorData = computed(() => (editorData.value?.kind === 'weapon' ? editorData.value : null));
const projectileEditorData = computed(() => (editorData.value?.kind === 'projectile' ? editorData.value : null));
const systemEditorData = computed(() => (editorData.value?.kind === 'system' ? editorData.value : null));
const { weapon: weaponDependencies, ship: shipImages, projectile: projectileImages } = useSpecEditorDependencies(windowModel, kind);
const shipSpriteForEditor = computed(() =>
  typeof shipImages?.value.value?.spriteData === 'string' ? shipImages.value.value.spriteData : '',
);
useContextMenuScope({
  identity: () => JSON.stringify(target.value),
  canRefresh: () => Boolean(editorData.value) && !editorData.value?.isNew,
  refresh: () =>
    windowModel.refresh([
      ...(shipImages?.value.value?.resourceRefs ?? []),
      ...(projectileImages?.value.value?.resourceRefs ?? []),
      ...(weaponDependencies?.resourceRefs.value ?? []),
    ]),
});
useManagedWindowRequests(async () => {
  await windowModel.initializeEditorWindow();
  if (!(await windowModel.waitForSave())) throw new Error('所属保存尚未完成');
});
const closeGuard = useDirtyWindowCloseGuard({
  content: '当前 spec 有未保存修改，关闭后这些修改将丢失。',
  dirty: draftDirty,
  title: '放弃未保存编辑？',
});

function closeWindow() {
  void closeCurrentWindow();
}

function openProjectile(projectileId: string) {
  if (!projectileId || !target.value) return;
  openSpecProjectileEditorWindow({
    modRoot: target.value.modRoot,
    id: projectileId,
    sessionId: target.value.sessionId,
    starsectorRoot,
  }).catch((error) => feedback.error(error, '打开弹体编辑器失败'));
}

function openPreview(weapon: import('@/shared/types/index').RowData) {
  if (!target.value) return;
  openWeaponFirePreviewWindow({
    modRoot: target.value.modRoot,
    id: target.value.id,
    sessionId: target.value.sessionId,
    source: { kind: 'draft', weapon },
  }).catch((error) => feedback.error(error, '打开发射预览失败'));
}

useShortcutDispatch({
  commands: {
    save: () => void saveEditorData(),
  },
});

onMounted(() => {
  void closeGuard.install();
});

onUnmounted(() => {
  closeGuard.dispose();
  disposeEditorWindow();
});
</script>
