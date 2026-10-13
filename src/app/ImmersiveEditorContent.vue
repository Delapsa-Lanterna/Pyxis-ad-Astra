<template>
  <ImmersiveEditorShell
    :compact="kind === 'variant'"
    :title="`${label}沉浸式编辑器 · ${joint.currentTarget.value?.id ?? root.id}`"
    :dirty="dirty"
    :saving="saving"
    :loading="loading"
    :error="errorText"
    :ready="ready"
    :locked="handoffLocked || vm.referenceChanging.value"
    :external-notice="externalUpdateNotice"
    :can-undo="history.canUndo.value"
    :can-redo="history.canRedo.value"
    @save="vm.save"
    @undo="vm.undo"
    @redo="vm.redo"
    @close="closeWindow"
    @retry="vm.initialize"
    @load-external="vm.loadExternal"
  >
    <ShipImmersivePanel v-if="panel?.kind === 'ship'" :panel="panel" :render="render" />
    <WeaponImmersivePanel v-else-if="panel?.kind === 'weapon'" :panel="panel" :render="render" />
    <WingImmersivePanel v-else-if="panel?.kind === 'wing'" :panel="panel" :render="render" />
    <VariantImmersivePanel v-else-if="panel?.kind === 'variant'" :panel="panel" :vm="vm">
      <template #meta>
        <ImmersiveEditorActions
          :can-undo="history.canUndo.value"
          :can-redo="history.canRedo.value"
          :saving="saving"
          :ready="ready && !vm.variantActionPending.value"
          @undo="vm.undo"
          @redo="vm.redo"
          @save="vm.save"
          @close="closeWindow"
        />
      </template>
      <template #status>
        <span class="variant-meta-status"><ImmersiveText :text="saving ? '保存中' : dirty ? '未保存' : '已保存'" /></span>
        <n-button v-if="externalUpdateNotice" size="small" @click="vm.loadExternal">载入外部版本</n-button>
      </template>
    </VariantImmersivePanel>
  </ImmersiveEditorShell>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue';
import type { JointEditRoot } from '@/shared/types';
import { useWindowContext } from '@/windows/window-context.window';
import { useManagedWindowRequests } from '@/app/composables/use-managed-window-requests';
import { useImmersiveEditorViewModel } from '@/app/composables/use-immersive-editor-view-model';
import { useDirtyWindowCloseGuard } from '@/app/composables/use-dirty-window-close-guard';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { closeCurrentWindow } from '@/windows/current.window';
import ImmersiveEditorShell from '@/app/components/immersive/ImmersiveEditorShell.vue';
import ShipImmersivePanel from '@/app/components/immersive/ShipImmersivePanel.vue';
import WeaponImmersivePanel from '@/app/components/immersive/WeaponImmersivePanel.vue';
import WingImmersivePanel from '@/app/components/immersive/WingImmersivePanel.vue';
import VariantImmersivePanel from '@/app/components/immersive/VariantImmersivePanel.vue';
import ImmersiveEditorActions from '@/app/components/immersive/ImmersiveEditorActions.vue';
import ImmersiveText from '@/app/components/immersive/ImmersiveText.vue';
import { editableRenderContext } from '@/app/components/immersive/immersive-render-context';
const context = useWindowContext('immersive-editor').value;
const { sessionId, modRoot, id, kind } = context.identity;
const rowKey = context.input.rowKey;
const root: JointEditRoot & { kind: 'ship' | 'weapon' | 'wing' | 'variant'; rowKey?: string } = {
  sessionId,
  modRoot,
  id,
  kind,
  ...(rowKey ? { rowKey } : {}),
};
useManagedWindowRequests(() => {});
const label = { ship: '舰船', weapon: '武器', wing: '战机', variant: '装配' }[kind];
const vm = useImmersiveEditorViewModel(root);
const render = editableRenderContext(vm);
const { joint, panel, errorText, history } = vm;
const { saving, loading, ready, handoffLocked, externalUpdateNotice } = joint;
const dirty = computed(() => joint.dirty.value || vm.variantActionPending.value);
useInputEditMode(joint.inputs);
const closeGuard = useDirtyWindowCloseGuard({
  dirty,
  title: '关闭沉浸式编辑器？',
  content: `当前${label}有未保存草稿或活动输入，关闭前确认所属保存。`,
});
function closeWindow() {
  void closeCurrentWindow();
}
useShortcutDispatch({
  commands: {
    save: () => {
      void vm.save();
    },
    undo: () => {
      void vm.undo();
    },
    redo: () => {
      void vm.redo();
    },
  },
  keys: { escape: closeWindow },
});
onMounted(async () => {
  await closeGuard.install();
  await vm.initialize();
});
onUnmounted(closeGuard.dispose);
</script>
