<template>
  <Transition name="mod-navigation-mask"
    ><button
      v-if="workspace.isModView && contentNavigation.state.narrow && contentNavigation.state.narrowExpanded"
      class="mod-navigation-backdrop ui-button"
      aria-label="关闭内容导航"
      @click="contentNavigation.close"
  /></Transition>
  <Transition name="mod-navigation-slide" :css="contentNavigation.state.narrow">
    <div
      v-if="workspace.isModView"
      v-show="!contentNavigation.state.narrow || contentNavigation.expanded.value"
      id="mod-navigation-content"
      class="mod-navigation-container ui-content-contained"
      :class="{ 'is-overlay': contentNavigation.state.narrow }"
      :inert="!contentNavigation.expanded.value"
      :aria-hidden="!contentNavigation.expanded.value"
      @keydown.esc="contentNavigation.close"
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
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useContentNavigation } from '@/app/composables/use-content-navigation';
import { buildModNavigationSections, isModNavigationItemActive, type ModNavigationItem } from '@/domain/workspace/mod-navigation';
import { useWorkspaceNavigationActions } from '@/app/composables/use-workspace-navigation-actions';
import { useTablesStore } from '@/stores/tables.store';
import { useWorkspaceStore } from '@/stores/workspace.store';

const contentNavigation = useContentNavigation();
const workspace = useWorkspaceStore();
const tables = useTablesStore();
const navigation = useWorkspaceNavigationActions();
const sections = computed(() => buildModNavigationSections(workspace.activeManifest));

function isActive(item: ModNavigationItem): boolean {
  return isModNavigationItemActive(item, workspace.currentView, workspace.configView, tables.currentTab);
}

function navigate(item: ModNavigationItem) {
  if (contentNavigation.state.narrow) contentNavigation.close();
  const modRoot = workspace.activeModRoot;
  if (!modRoot) return;
  if (item.target.type === 'mod-files') {
    navigation.navigateToModFiles(modRoot);
    return;
  }
  if (item.target.type === 'config') {
    navigation.navigateToModConfig(modRoot, item.target.view);
    return;
  }
  navigation.navigateToModTable(modRoot, item.target.table);
}
</script>
