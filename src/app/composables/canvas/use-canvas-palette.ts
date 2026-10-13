import { computed, watch } from 'vue';
import { createCanvasPalette } from '@/domain/editors/lib/canvas-palette';
import { useSettingsStore } from '@/stores/settings.store';

export function useCanvasPalette(draw: () => void) {
  const settings = useSettingsStore();
  const palette = computed(() => createCanvasPalette(settings.themeColors));
  watch(palette, draw, { flush: 'post' });
  return palette;
}
