<template>
  <Transition name="mod-navigation-mask"
    ><button
      v-if="workspace.isModView && modNavigationPanel.state.narrow && modNavigationPanel.state.narrowExpanded"
      class="mod-navigation-backdrop ui-button"
      aria-label="收起导航栏"
      @click="modNavigationPanel.close"
  /></Transition>
  <Transition name="mod-navigation-slide" :css="modNavigationPanel.state.narrow">
    <div
      v-if="workspace.isModView"
      v-show="!modNavigationPanel.state.narrow || modNavigationPanel.expanded.value"
      id="mod-navigation-content"
      class="mod-navigation-container ui-content-contained"
      :class="{ 'is-overlay': modNavigationPanel.state.narrow }"
      :inert="!modNavigationPanel.expanded.value"
      :aria-hidden="!modNavigationPanel.expanded.value"
      @keydown.esc="modNavigationPanel.close"
    >
      <aside class="nav-pane ui-content-contained ui-layout-row ui-layout-stack ui-content-surface-muted ui-layout-clip">
        <template v-if="workspace.isModView && workspace.activeMod">
          <div class="nav-label ui-layout-row ui-layout-center ui-text-muted">Mod 内容</div>

          <div v-if="workspace.activeMod.status === 'ready'" class="mod-navigation ui-layout-row ui-layout-stack">
            <template v-for="(section, sectionIndex) in sections" :key="section.id">
              <div v-if="sectionIndex > 0" class="mod-navigation-separator" />
              <button
                v-for="item in section.items"
                :key="item.id"
                class="mod-navigation-button ui-button ui-control-between ui-text-soft ui-control-pointer ui-text-small ui-layout-grid ui-layout-center"
                :class="{ active: isActive(item) }"
                type="button"
                @click="navigate(item)"
              >
                <span class="mod-navigation-button-label">{{ item.label }}</span>
                <span v-if="item.count !== null" class="mod-navigation-count mod-navigation-button-label ui-text-muted">{{
                  item.count
                }}</span>
              </button>
            </template>
          </div>

          <div v-else-if="workspace.activeMod.status === 'loading'" class="nav-empty-hint ui-text-muted ui-text-small">
            正在读取当前 Mod…
          </div>
          <div v-else class="nav-empty-hint nav-error-hint ui-text-muted ui-text-small">
            {{ workspace.activeMod.error || '当前 Mod 无法读取。' }}
          </div>
        </template>

        <div v-else class="nav-empty-hint ui-text-muted ui-text-small">从顶部选择一个 Mod 页签以查看内容。</div>
      </aside>
    </div></Transition
  >
  <button
    v-if="workspace.isModView"
    class="mod-navigation-toggle ui-panel-toggle ui-button ui-control-button ui-control-reset"
    :class="{ 'is-collapsed': !modNavigationPanel.expanded.value }"
    type="button"
    :title="modNavigationPanel.expanded.value ? '收起导航栏' : '展开导航栏'"
    :aria-label="modNavigationPanel.expanded.value ? '收起导航栏' : '展开导航栏'"
    :aria-expanded="modNavigationPanel.expanded.value"
    aria-controls="mod-navigation-content"
    @click="modNavigationPanel.toggle"
    @keydown.esc="modNavigationPanel.close"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useModNavigationPanel } from '@/app/composables/use-mod-navigation-panel';
import { buildModNavigationSections, isModNavigationItemActive, type ModNavigationItem } from '@/domain/workspace/mod-navigation';
import { useWorkspaceNavigationActions } from '@/app/composables/use-workspace-navigation-actions';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

const modNavigationPanel = useModNavigationPanel();
const workspace = useWorkspaceStore();
const tables = useCsvEditorStore();
const navigation = useWorkspaceNavigationActions();
const sections = computed(() => buildModNavigationSections(workspace.activeManifest));

function isActive(item: ModNavigationItem): boolean {
  return isModNavigationItemActive(item, workspace.currentView, workspace.jsonPage, tables.currentTab);
}

function navigate(item: ModNavigationItem) {
  if (modNavigationPanel.state.narrow) modNavigationPanel.close();
  const modRoot = workspace.activeModRoot;
  if (!modRoot) return;
  if (item.target.type === 'mod-files') {
    navigation.navigateToModFiles(modRoot);
    return;
  }
  if (item.target.type === 'mod-overview') {
    navigation.navigateToModOverview(modRoot);
    return;
  }
  if (item.target.type === 'file-history') {
    navigation.navigateToModFileHistory(modRoot);
    return;
  }
  if (item.target.type === 'json-editor') {
    navigation.navigateToModJson(modRoot, item.target.page);
    return;
  }
  navigation.navigateToModTable(modRoot, item.target.table);
}
</script>
