<template>
  <ImmersiveEditorShell
    :title="`${label}沉浸式编辑器 · ${joint.currentTarget.value?.id ?? root.id}`"
    :dirty="dirty"
    :saving="saving"
    :loading="loading"
    :error="errorText"
    :ready="ready"
    :locked="handoffLocked"
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
    <ShipImmersivePanel v-if="panel?.kind === 'ship'" :panel="panel" :vm="vm" />
    <WeaponImmersivePanel v-else-if="panel?.kind === 'weapon'" :panel="panel" :vm="vm" />
  </ImmersiveEditorShell>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import type { JointEditRoot } from '@/shared/types';
import { AppError } from '@/shared/lib/errors';
import { useImmersiveEditorViewModel } from '@/app/composables/use-immersive-editor-view-model';
import { useDirtyWindowCloseGuard } from '@/app/composables/use-dirty-window-close-guard';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { closeCurrentWindow } from '@/windows/current.window';
import ImmersiveEditorShell from '@/app/components/immersive/ImmersiveEditorShell.vue';
import ShipImmersivePanel from '@/app/components/immersive/ShipImmersivePanel.vue';
import WeaponImmersivePanel from '@/app/components/immersive/WeaponImmersivePanel.vue';
const params = new URLSearchParams(window.location.search);
const sessionId = params.get('sessionId'),
  modRoot = params.get('modRoot'),
  id = params.get('id'),
  kind = params.get('kind');
if (!sessionId || !modRoot || !id || (kind !== 'ship' && kind !== 'weapon'))
  throw new AppError('缺少有效沉浸式窗口身份', { action: 'open-immersive-editor' });
const root: JointEditRoot & { kind: 'ship' | 'weapon' } = { sessionId, modRoot, id, kind };
const label = kind === 'ship' ? '舰船' : '武器';
const vm = useImmersiveEditorViewModel(root);
const { joint, panel, errorText, history } = vm;
const { dirty, saving, loading, ready, handoffLocked, externalUpdateNotice } = joint;
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
