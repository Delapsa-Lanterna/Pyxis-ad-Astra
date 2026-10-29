<template>
  <div class="browser-appearance ui-control-row" aria-label="夹具外观">
    <NSwitch
      aria-label="主题明暗"
      :value="settings.theme === 'dark'"
      :theme="settings.theme === 'dark' ? darkTheme.Switch : lightTheme.Switch"
      :theme-overrides="{ railColorActive: accentHex }"
      @update:value="emit('change', { theme: $event ? 'dark' : 'light' })"
      ><template #checked>深色</template><template #unchecked>浅色</template></NSwitch
    >
    <button
      v-for="preset in ACCENT_PRESETS"
      :key="preset.value"
      class="browser-accent"
      :aria-label="'主题色：' + preset.name"
      :title="preset.name"
      :aria-pressed="settings.accent === preset.value"
      @click="emit('change', { accent: preset.value })"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="7" :fill="preset.hex" /></svg>
    </button>
    <NColorPicker
      :value="settings.customAccent"
      :modes="['hex']"
      :show-alpha="false"
      :theme="settings.theme === 'dark' ? darkTheme.ColorPicker : lightTheme.ColorPicker"
      @update:value="selectColor"
      ><template #trigger="{ onClick }"
        ><button class="browser-accent" aria-label="自定义颜色" :aria-pressed="settings.accent === 'custom'" @click="onClick">
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="7" :fill="settings.customAccent" />
          </svg></button></template
    ></NColorPicker>
    <input
      class="browser-custom-hex"
      type="text"
      aria-label="自定义颜色值"
      :value="settings.customAccent"
      placeholder="#RRGGBB"
      pattern="#[0-9a-fA-F]{6}"
      @change="inputColor"
    />
  </div>
</template>
<script setup lang="ts">
import { ACCENT_PRESETS } from '@/domain/settings/theme';
import type { AppSettings } from '@/shared/types';
import { computed } from 'vue';
import { NSwitch } from 'naive-ui/es/switch';
import { NColorPicker } from 'naive-ui/es/color-picker';
import { normalizeHex } from '@/domain/settings/rules';
import { darkTheme, lightTheme } from 'naive-ui/es/themes';
import './browser.css';
export type BrowserAppearanceState = Pick<AppSettings, 'theme' | 'accent' | 'customAccent'>;
const props = defineProps<{ settings: BrowserAppearanceState }>();
const emit = defineEmits<{ change: [patch: Partial<BrowserAppearanceState>] }>();
const accentHex = computed(() =>
  props.settings.accent === 'custom'
    ? props.settings.customAccent
    : ACCENT_PRESETS.find(({ value }) => value === props.settings.accent)!.hex,
);
function selectColor(color: string | null) {
  if (color) emit('change', { accent: 'custom', customAccent: color });
}
function inputColor(event: Event) {
  const input = event.currentTarget as HTMLInputElement,
    color = normalizeHex(input.value);
  input.setCustomValidity(color ? '' : '请输入 #RRGGBB 颜色值');
  if (color) selectColor(color);
  else input.reportValidity();
}
</script>
