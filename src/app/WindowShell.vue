<template>
  <n-config-provider :theme="naiveTheme" :theme-overrides="themeOverrides">
    <n-message-provider :duration="10000" closable keep-alive-on-hover>
      <n-dialog-provider>
        <EditTargetHandoffLifecycle><slot /></EditTargetHandoffLifecycle>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { darkTheme } from 'naive-ui/es/themes';
import { IMMERSIVE_COLORS } from '@/domain/immersive/appearance';
import EditTargetHandoffLifecycle from '@/app/EditTargetHandoffLifecycle.vue';
import { useCoreAssetsLifecycle } from '@/app/composables/use-core-assets';
import { useSettingsStore } from '@/stores/settings.store';
import { buildThemeOverrides } from '@/app/theme-overrides';
import { useThemeDomEffect } from '@/app/composables/settings/use-theme-dom-effect';
import { useSettingsPersistence, useSettingsMirror } from '@/app/composables/settings/use-settings-persistence';

const props = withDefaults(defineProps<{ mode?: 'main' | 'child'; appearance?: 'application' | 'immersive' }>(), {
  mode: 'child',
  appearance: 'application',
});

const settings = useSettingsStore();
useCoreAssetsLifecycle();
if (props.mode === 'main') useSettingsPersistence();
else useSettingsMirror();
const colors = computed(() => (props.appearance === 'immersive' ? IMMERSIVE_COLORS : settings.themeColors));
const theme = computed(() => (props.appearance === 'immersive' ? ('dark' as const) : settings.theme));
const naiveTheme = computed(() => (theme.value === 'dark' ? darkTheme : null));
useThemeDomEffect(() => ({ colors: colors.value, theme: theme.value }));
const themeOverrides = computed(() => buildThemeOverrides(colors.value, settings.fontFamily));
</script>
