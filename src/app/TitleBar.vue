<template>
  <header
    class="titlebar ui-text-normal ui-layout-row ui-layout-center ui-content-surface"
    @pointerdown="startDrag"
    @dblclick="toggleMaximize"
  >
    <div class="titlebar-brand ui-control-row ui-control-reset ui-layout-shrink">
      <img class="titlebar-mark ui-image" :src="appIcon" alt="星界罗盘 [Circinus ad Astra]" draggable="false" />
      <div class="titlebar-text ui-layout-grid ui-layout-shrink">
        <strong class="titlebar-text-value ui-emphasis ui-text-truncate ui-text-small">{{
          title || '星界罗盘 [Circinus ad Astra]'
        }}</strong>
        <span
          class="titlebar-text-label ui-text-truncate ui-text-meta ui-text-muted"
          :title="subtitle ?? workspace.activeManifest?.modRoot ?? ''"
          >{{ subtitle ?? (workspace.activeMod?.displayName || '尚未打开项目') }}</span
        >
      </div>
    </div>

    <div class="titlebar-controls ui-layout-row ui-layout-center" @pointerdown.stop @dblclick.stop>
      <n-popover v-if="!title" v-model:show="workspaceMenuVisible" placement="bottom-end" trigger="click">
        <template #trigger>
          <button
            class="titlebar-button ui-button ui-control-button ui-text-soft ui-layout-grid ui-control-reset"
            type="button"
            title="工作区菜单"
            aria-label="工作区菜单"
          >
            <svg class="titlebar-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M10.3 3.48 9.7 5.6a6.77 6.77 0 0 0-1.64.95l-2.1-.63-1.5 2.6 1.53 1.56a6.8 6.8 0 0 0 0 1.9L4.46 13.54l1.5 2.6 2.1-.63c.5.39 1.05.7 1.64.95l.6 2.12h3l.6-2.12c.59-.25 1.14-.56 1.64-.95l2.1.63 1.5-2.6-1.53-1.56a6.8 6.8 0 0 0 0-1.9l1.53-1.56-1.5-2.6-2.1.63a6.77 6.77 0 0 0-1.64-.95l-.6-2.12h-3Z"
              />
              <path d="M12 14.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
            </svg>
          </button>
        </template>
        <div class="titlebar-workspace-menu ui-layout-grid ui-control-reset">
          <button
            class="ui-button titlebar-workspace-menu-button ui-control-button ui-text-soft ui-text-small ui-control-pointer ui-layout-stretch"
            type="button"
            :class="{ active: workspace.currentView === 'settings' }"
            @click="showSettings"
          >
            设置
          </button>
          <button
            class="ui-button titlebar-workspace-menu-button ui-control-button ui-text-soft ui-text-small ui-control-pointer ui-layout-stretch"
            type="button"
            :class="{ active: workspace.currentView === 'about' }"
            @click="showAbout"
          >
            关于
          </button>
        </div>
      </n-popover>
      <button
        v-if="!title"
        class="titlebar-button ui-button ui-control-button ui-text-soft ui-layout-grid ui-control-reset"
        type="button"
        :title="settings.isDark ? '切换到浅色' : '切换到暗色'"
        @click="settings.toggleTheme"
      >
        <svg class="titlebar-button-icon ui-control-icon" v-if="settings.isDark" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 4.75V3m0 18v-1.75M5.81 5.81 4.58 4.58m14.84 14.84-1.23-1.23M4.75 12H3m18 0h-1.75M5.81 18.19l-1.23 1.23M19.42 4.58l-1.23 1.23M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"
          />
        </svg>
        <svg class="titlebar-button-icon ui-control-icon" v-else viewBox="0 0 24 24" aria-hidden="true">
          <path d="M20.25 14.3A7.78 7.78 0 0 1 9.7 3.75 8.5 8.5 0 1 0 20.25 14.3Z" />
        </svg>
      </button>
      <button
        class="titlebar-button ui-button ui-control-button ui-text-soft ui-layout-grid ui-control-reset"
        type="button"
        title="最小化"
        @click="minimizeWindow"
      >
        <svg class="titlebar-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <button
        class="titlebar-button ui-button ui-control-button ui-text-soft ui-layout-grid ui-control-reset"
        type="button"
        :title="isMaximized ? '还原' : '最大化'"
        @click="toggleMaximize"
      >
        <svg class="titlebar-button-icon ui-control-icon" v-if="isMaximized" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 8h9v9H8zM6 15H5V5h10v1" />
        </svg>
        <svg class="titlebar-button-icon ui-control-icon" v-else viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z" /></svg>
      </button>
      <button
        class="titlebar-button close ui-button ui-control-button ui-text-soft ui-layout-grid ui-control-reset"
        type="button"
        title="关闭"
        @click="closeWindow"
      >
        <svg class="titlebar-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import appIcon from '@/assets/app-icon.svg';
import { useWorkspaceNavigationActions } from '@/app/composables/use-workspace-navigation-actions';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useSettingsStore } from '@/stores/settings.store';
import {
  closeCurrentWindow,
  isCurrentWindowMaximized,
  minimizeCurrentWindow,
  startCurrentWindowDrag,
  toggleMaximizeCurrentWindow,
} from '@/windows/current.window';
const workspace = useWorkspaceStore();
const props = defineProps<{ title?: string; subtitle?: string }>();
const settings = useSettingsStore();
const isMaximized = ref(false);
const workspaceMenuVisible = ref(false);
const navigation = props.title ? null : useWorkspaceNavigationActions();

async function refreshMaximized() {
  isMaximized.value = await isCurrentWindowMaximized();
}

async function startDrag(event: { button: number; detail: number }) {
  if (event.button !== 0 || event.detail > 1) return;
  await startCurrentWindowDrag();
}

async function minimizeWindow() {
  await minimizeCurrentWindow();
}

async function toggleMaximize() {
  await toggleMaximizeCurrentWindow();
  await refreshMaximized();
}

async function closeWindow() {
  await closeCurrentWindow();
}

function showSettings() {
  workspaceMenuVisible.value = false;
  navigation!.showSettings();
}

function showAbout() {
  workspaceMenuVisible.value = false;
  navigation!.showAbout();
}

if (!props.title)
  useContextMenuScope({
    identity: () => JSON.stringify([workspace.currentView, workspace.configView, workspace.activeModRoot]),
    windowActions: { 设置: showSettings, 关于: showAbout, 最小化: minimizeWindow, 退出: closeWindow },
  });

onMounted(refreshMaximized);
</script>
