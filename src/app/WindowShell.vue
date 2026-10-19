<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-message-provider :duration="10000" closable keep-alive-on-hover>
      <n-dialog-provider>
        <WindowRuntime
          ><ContextMenu
            ><div v-if="title" class="app-frame app-frame-child ui-content-grid ui-content-contained">
              <TitleBar :title="title" :subtitle="windowModName" /><slot />
            </div>
            <slot v-else /></ContextMenu
        ></WindowRuntime>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ContextMenu from '@/app/components/ContextMenu.vue';
import { darkTheme } from 'naive-ui/es/themes';
import { IMMERSIVE_COLORS } from '@/domain/immersive/appearance';
import WindowRuntime from '@/app/WindowRuntime.vue';
import TitleBar from '@/app/TitleBar.vue';
import { windowModName } from '@/windows/window-context.window';
import { useCoreAssetsLifecycle } from '@/app/composables/use-core-assets';
import { useSettingsStore } from '@/stores/settings.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { buildThemeOverrides } from '@/app/theme-overrides';
import { useThemeDomEffect } from '@/app/composables/settings/use-theme-dom-effect';
import { useAppSettings } from '@/app/composables/use-app-lifecycle-assembly';
import { useWindowImageRuntimeLifetime } from '@/app/composables/use-window-image-runtime';

const props = withDefaults(defineProps<{ mode?: 'main' | 'child'; appearance?: 'application' | 'immersive'; title?: string }>(), {
  mode: 'child',
  appearance: 'application',
  title: '',
});

const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const coreRoot = computed(
  () => settings.starsectorRoot ?? workspace.gameOverview?.starsectorRoot ?? workspace.activeManifest?.starsectorRoot ?? null,
);
useWindowImageRuntimeLifetime();
useCoreAssetsLifecycle(coreRoot);
useAppSettings(props.mode);
const colors = computed(() => (props.appearance === 'immersive' ? IMMERSIVE_COLORS : settings.themeColors));
const theme = computed(() => (props.appearance === 'immersive' ? ('dark' as const) : settings.theme));
const naiveTheme = computed(() => (theme.value === 'dark' ? darkTheme : null));
useThemeDomEffect(() => ({ colors: colors.value, theme: theme.value }));
const themeOverrides = computed(() => buildThemeOverrides(colors.value, settings.fontFamily, props.appearance));
</script>
