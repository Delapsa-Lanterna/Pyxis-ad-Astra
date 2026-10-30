<template>
  <nav
    v-if="workspace.hasWorkspaceContext"
    class="mod-tabs-bar ui-control-row ui-content-surface-muted ui-layout-grid ui-layout-shrink"
    aria-label="已打开 Mod"
  >
    <button
      class="mod-tabs-overview ui-button ui-control-button ui-text-muted ui-layout-grid ui-control-reset ui-text-reset ui-text-soft ui-control-pointer ui-content-surface"
      :class="{ active: workspace.currentView === 'overview' }"
      type="button"
      title="打开工作区总览"
      aria-label="打开工作区总览"
      data-refresh="workspace"
      @click="navigation.showOverview()"
    >
      <svg class="mod-tabs-overview-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
    </button>
    <button
      v-if="coreModRoot"
      class="mod-tabs-overview ui-button ui-control-button ui-text-muted ui-layout-grid ui-control-reset ui-text-reset ui-text-soft ui-control-pointer ui-content-surface"
      :class="{ active: workspace.isModView && workspace.activeModRoot === coreModRoot }"
      :aria-pressed="workspace.isModView && workspace.activeModRoot === coreModRoot"
      type="button"
      title="打开原版"
      aria-label="打开原版"
      data-refresh="core"
      @click="navigation.openCore()"
    >
      <span class="mod-tab-activate ui-layout-row ui-layout-center"
        ><svg class="mod-tabs-overview-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" /></svg
        ><span v-if="hasDirtyChanges(coreModRoot)" class="mod-tab-dirty" title="有未保存修改" />
        <span v-else class="mod-tab-status" :class="coreStatus" :title="modStatusLabel(coreStatus)"
      /></span>
    </button>
    <div class="mod-tabs-list ui-control-row ui-layout-row ui-layout-shrink" role="tablist">
      <div
        v-for="mod in modTabs"
        :key="mod.modRoot"
        class="mod-tab ui-text-soft ui-layout-row ui-layout-center ui-text-normal ui-content-surface"
        :class="{
          active: workspace.isModView && workspace.activeModRoot === mod.modRoot,
          referenceable: workspace.referenceableModRoots.has(mod.modRoot),
          'drop-before': dropTarget?.root === mod.modRoot && !dropTarget.after,
          'drop-after': dropTarget?.root === mod.modRoot && dropTarget.after,
        }"
        :title="mod.modRoot"
        :data-mod-root="mod.modRoot"
        @dragover="dragOver($event, mod.modRoot)"
        @drop="drop"
      >
        <button
          class="mod-tab-activate ui-button ui-control-row ui-control-button ui-control-pointer"
          role="tab"
          type="button"
          :aria-selected="workspace.isModView && workspace.activeModRoot === mod.modRoot"
          draggable="true"
          @dragstart="startDrag($event, mod.modRoot)"
          @dragend="finishDrag"
          @click="navigation.activateModTab(mod.modRoot)"
        >
          <span class="mod-tab-name ui-text-truncate ui-layout-shrink ui-text-small">{{ mod.displayName }}</span>
          <span v-if="hasDirtyChanges(mod.modRoot)" class="mod-tab-dirty" title="有未保存修改" />
          <span v-else class="mod-tab-status" :class="mod.status" :title="modStatusLabel(mod.status)" />
          <span v-if="mod.status === 'error' && mod.error" class="mod-tab-error-label ui-text-truncate" :title="mod.error"> 读取失败 </span>
        </button>
        <button
          class="mod-tab-close ui-button ui-control-button ui-text-muted ui-layout-grid ui-control-reset ui-control-pointer"
          type="button"
          title="从工作区移除"
          @click.stop="$emit('remove-mod', mod.modRoot)"
        >
          <svg class="mod-tab-close-icon ui-control-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="m4 4 8 8m0-8-8 8" /></svg>
        </button>
      </div>
    </div>
  </nav>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { pathBasename } from '@/shared/lib/paths';
import { modStatusLabel } from '@/domain/workspace/mod-status';
import { useWorkspaceNavigationActions } from '@/app/composables/use-workspace-navigation-actions';
import { useDraftSessionsStore } from '@/stores/draft-sessions.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import type { useWorkspaceShellActions } from '@/app/composables/use-workspace-shell-actions';
import { useProjectStore } from '@/stores/project.store';
import { useCoreAssetsStore } from '@/stores/core-assets.store';

const props = defineProps<{
  refreshActions: Pick<
    ReturnType<typeof useWorkspaceShellActions>,
    'refreshWorkspace' | 'refreshModOverview' | 'refreshTabInfo' | 'refreshCore'
  >;
}>();
defineEmits<{ 'remove-mod': [modRoot: string] }>();

const workspace = useWorkspaceStore();
const project = useProjectStore();
const core = useCoreAssetsStore();
const draftSessions = useDraftSessionsStore();
const navigation = useWorkspaceNavigationActions();
const { coreModRoot } = navigation;
const coreStatus = computed(() => {
  const statuses = [workspace.mods.get(coreModRoot.value!)?.status, core.fields.status, core.graphics.status];
  return statuses.includes('error') ? 'error' : statuses.includes('loading') ? 'loading' : 'ready';
});
const modTabs = computed(() => workspace.loadedModList.filter((mod) => pathBasename(mod.modRoot).toLowerCase() !== 'starsector-core'));
const draggedRoot = ref<string | null>(null);
const dropTarget = ref<{ root: string; after: boolean } | null>(null);

useContextMenuScope({
  identity: () =>
    JSON.stringify([
      core.root,
      workspace.getWorkspaceGeneration(),
      workspace.loadedModList.map((mod) => [
        mod.modRoot,
        mod.referenceable,
        workspace.referenceableModRoots.has(mod.modRoot),
        mod.status,
        workspace.getModGeneration(mod.modRoot),
        project.getSessionId(mod.modRoot),
      ]),
    ]),
  canRefresh: (target) => {
    const root = target.closest<HTMLElement>('[data-mod-root]')?.dataset.modRoot;
    return root ? workspace.mods.get(root)!.status === 'ready' : true;
  },
  refresh: (_current, target) => {
    const root = target.closest<HTMLElement>('[data-mod-root]')?.dataset.modRoot;
    if (root) return props.refreshActions.refreshModOverview(root);
    const kind = target.closest<HTMLElement>('[data-refresh]')?.dataset.refresh;
    if (kind === 'workspace') return props.refreshActions.refreshWorkspace();
    if (kind === 'core') return props.refreshActions.refreshCore(core.root!);
    return props.refreshActions.refreshTabInfo(modTabs.value.filter((mod) => mod.status === 'ready').map((mod) => mod.modRoot));
  },
  actions: (target) => {
    const root = target.closest<HTMLElement>('[data-mod-root]')?.dataset.modRoot;
    if (!root) return [];
    const mod = workspace.mods.get(root)!;
    const referenceable = workspace.referenceableModRoots.has(root);
    return [
      {
        label: referenceable ? '取消可引用' : '设为可引用',
        disabled: mod.status !== 'ready',
        run: () => workspace.setModReferenceable(root, !referenceable),
      },
      ...(mod.referenceable === undefined
        ? []
        : [{ label: '恢复自动引用', disabled: mod.status !== 'ready', run: () => workspace.setModReferenceable(root, undefined) }]),
    ];
  },
});

function startDrag(event: DragEvent, root: string) {
  draggedRoot.value = root;
  event.dataTransfer!.effectAllowed = 'move';
  event.dataTransfer!.setData('text/plain', root);
}
function dragOver(event: DragEvent, root: string) {
  if (!draggedRoot.value || draggedRoot.value === root) {
    dropTarget.value = null;
    return;
  }
  event.preventDefault();
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  dropTarget.value = { root, after: event.clientX > bounds.x + bounds.width / 2 };
}
function drop(event: DragEvent) {
  if (!draggedRoot.value || !dropTarget.value) return;
  event.preventDefault();
  workspace.moveMod(draggedRoot.value, dropTarget.value.root, dropTarget.value.after);
  finishDrag();
}
function finishDrag() {
  draggedRoot.value = null;
  dropTarget.value = null;
}

function hasDirtyChanges(modRoot: string): boolean {
  return draftSessions.hasUnsavedWorkForMod(modRoot);
}
</script>
