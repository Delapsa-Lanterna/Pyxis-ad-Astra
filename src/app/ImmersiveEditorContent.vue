<template>
  <ImmersiveEditorShell
    :label="label"
    :object-id="joint.currentTarget.value?.id ?? id"
    :target-key="joint.currentTargetKey.value ?? id"
    :reference-changing="vm.referenceChanging.value"
    :compact="kind === 'variant'"
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
    @retry="vm.retry"
    @slow="vm.logSlowPreparation"
    @load-external="vm.loadExternal"
  >
    <ShipImmersivePanel v-if="panel?.kind === 'ship'" :panel="panel" :render="render" />
    <WeaponImmersivePanel
      v-else-if="panel?.kind === 'weapon'"
      :panel="panel"
      :render="render"
      @open-projectile="vm.openProjectile"
      @preview="vm.openPreview"
    />
    <WingImmersivePanel
      v-else-if="panel?.kind === 'wing'"
      :panel="panel"
      :render="render"
      @create-source="vm.wing!.createMissingSource"
      @open-editor="vm.wing!.openRelatedEditor"
    />
    <VariantImmersivePanel v-else-if="panel?.kind === 'variant'" :panel="panel" :vm="vm.variant!" :render="render">
      <template #meta>
        <ImmersiveEditorActions
          :dirty="dirty"
          :can-undo="history.canUndo.value"
          :can-redo="history.canRedo.value"
          :saving="saving"
          :ready="ready && !vm.variantActionPending.value"
          @undo="vm.undo"
          @redo="vm.redo"
          @save="vm.save"
          @close="closeWindow"
        >
          <span class="immersive-meta-status" role="status">{{ saving ? '保存中' : dirty ? '未保存' : '已保存' }}</span>
          <n-button v-if="externalUpdateNotice" size="small" @click="vm.loadExternal">载入外部版本</n-button>
        </ImmersiveEditorActions>
      </template>
    </VariantImmersivePanel>
  </ImmersiveEditorShell>
</template>
<script setup lang="ts">
import { provideFieldInputs } from '@/shared/runtime/field-inputs';
import { computed, onMounted, onUnmounted } from 'vue';
import type { JointEditRoot } from '@/shared/types';
import { useWindowContext } from '@/windows/window-context.window';
import { useManagedWindowRequests } from '@/app/composables/use-managed-window-requests';
import { useImmersiveEditorViewModel, editableRenderContext } from '@/app/composables/immersive-editor-assembly';
import { useDirtyWindowCloseGuard } from '@/app/composables/use-dirty-window-close-guard';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { closeCurrentWindow } from '@/windows/current.window';
import ImmersiveEditorShell from '@/app/components/immersive/ImmersiveEditorShell.vue';
import ShipImmersivePanel from '@/app/components/immersive/ship/ShipImmersivePanel.vue';
import WeaponImmersivePanel from '@/app/components/immersive/weapon/WeaponImmersivePanel.vue';
import WingImmersivePanel from '@/app/components/immersive/wing/WingImmersivePanel.vue';
import VariantImmersivePanel from '@/app/components/immersive/variant/VariantImmersivePanel.vue';
import ImmersiveEditorActions from '@/app/components/immersive/ImmersiveEditorActions.vue';
import { provideOriginalFonts } from '@/app/composables/use-original-fonts';
const context = useWindowContext('immersive-editor').value;
const { sessionId, modRoot, id, kind } = context.identity;
provideOriginalFonts(() => sessionId);
const rowKey = context.input.rowKey;
const root: JointEditRoot & { kind: import('@/shared/types').JointEditKind; rowKey?: string } = {
  sessionId,
  modRoot,
  id,
  kind,
  ...(rowKey ? { rowKey } : {}),
};
const vm = useImmersiveEditorViewModel(root);
provideFieldInputs(vm.joint.inputs);
useManagedWindowRequests(async (request) => {
  if (!(await vm.joint.waitForSave())) throw new Error('所属保存尚未完成');
  if (request.kind === 'immersive-editor') await vm.initialize(request.input.rowKey);
});
const label = vm.label;
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
});
onUnmounted(closeGuard.dispose);
</script>
