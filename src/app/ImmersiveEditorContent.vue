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
    :ready="ready && !fileWaiting"
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
    <EditorProblems :issues="joint.problems.issues.value" @locate="locateProblem" />
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
    <VariantImmersivePanel v-else-if="panel?.kind === 'variant'" ref="variantPanel" :panel="panel" :vm="vm.variant!" :render="render">
      <template #meta>
        <ImmersiveEditorActions
          :dirty="dirty"
          :can-undo="history.canUndo.value"
          :can-redo="history.canRedo.value"
          :saving="saving"
          :ready="ready && !fileWaiting && !vm.variantActionPending.value"
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
import { useProjectSyncStore } from '@/stores/project-sync.store';
import { computed, onMounted, nextTick, useTemplateRef } from 'vue';
import type { JointEditRoot, JointEditKind, FieldProblem } from '@/shared/types';
import EditorProblems from '@/shared/ui/EditorProblems.vue';
import { normalizeFsPath } from '@/shared/lib/paths';
import { extractFileReferenceFromError } from '@/shared/lib/errors';
import { compositionPath } from '@/domain/json-composition';
import type { ImmersiveField } from '@/domain/immersive/fields';
import { useWindowContext } from '@/windows/window-context.window';
import { useManagedWindowRequests } from '@/app/composables/use-managed-window-requests';
import { useImmersiveEditorViewModel, editableRenderContext } from '@/app/composables/immersive-editor-assembly';
import { useWindowCloseParticipant } from '@/app/composables/use-window-close-state';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useFieldEditMode } from '@/app/composables/field-editor/use-field-edit-mode';
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
const root: JointEditRoot & { kind: JointEditKind; rowKey?: string } = {
  sessionId,
  modRoot,
  id,
  kind,
  ...(rowKey ? { rowKey } : {}),
};
const vm = useImmersiveEditorViewModel(root);
const feedback = useAppFeedback();
provideFieldInputs(vm.joint.inputs);
useManagedWindowRequests(async (request) => {
  if (!(await vm.joint.waitForSave())) throw new Error('所属保存尚未完成');
  if (request.kind === 'immersive-editor') await vm.initialize(request.input.rowKey);
});
const label = vm.label;
const render = editableRenderContext(vm);
const { joint, panel, errorText, history } = vm;
const variantPanel = useTemplateRef('variantPanel');
async function locateProblem(issue: FieldProblem) {
  const key = joint.currentTargetKey.value;
  const admitted = joint.inputs.captureContext();
  const current = () => vm.isActive() && admitted() && joint.currentTargetKey.value === key;
  try {
    if (issue.code === 'field.input_invalid') return await joint.inputs.focus(issue.path);
    const record = vm.snapshot.value!.records.find((item) => {
      const write = item.target.kind === 'spec' ? item.target.target.write : item.target.write;
      return (
        normalizeFsPath(write.path) === normalizeFsPath(issue.location?.path ?? '') &&
        (item.target.kind !== 'csv' || item.target.rowKey === issue.location?.rowKey)
      );
    });
    const parts = compositionPath(issue.location?.field ?? issue.path);
    if (record && variantPanel.value && (await variantPanel.value.locate(record.key, parts, current))) return;
    if (!current()) return;
    const matches = (field: ImmersiveField) =>
      field.recordKey === record?.key && compositionPath(field.schema.key).every((part, i) => parts[i] === part);
    const stat = panel.value?.allStats.find((item) => item.fields.some(matches));
    if (!stat) {
      const reference = extractFileReferenceFromError({ code: issue.code, message: issue.message, location: issue.location ?? null });
      if (reference) await feedback.fileActions(reference, 'error', issue.code)[0]?.run();
      return;
    }
    await vm.toggleStat(stat.id, true);
    await nextTick();
    if (!current() || vm.selectedStatId.value !== stat.id) return;
    const field = stat.fields.find(matches)!;
    const target = document.querySelector<HTMLElement>(`[data-field-id="${CSS.escape(field.id)}"]`);
    const input = target?.querySelector<HTMLElement>('input,textarea');
    input?.scrollIntoView({ block: 'nearest' });
    input?.focus();
  } catch (error) {
    feedback.error(error, '定位联合字段失败');
  }
}
const { saving, loading, ready, handoffLocked, externalUpdateNotice } = joint;
const fileWaiting = computed(() => useProjectSyncStore().isWaiting(modRoot));
const dirty = computed(() => joint.dirty.value || vm.variantActionPending.value);
useFieldEditMode(joint.inputs);
const closeParticipant = useWindowCloseParticipant({
  dirty,
  title: '关闭沉浸式编辑器？',
  get content() {
    return label + ' ' + joint.currentTarget.value!.id + ' 有未保存草稿或尚在输入的内容，关闭后将丢弃这些编辑。';
  },
});
function closeWindow() {
  void closeCurrentWindow().catch((error) => feedback.error(error, '关闭窗口失败'));
}
useWindowShortcuts({
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
  await closeParticipant.install();
});
</script>
