<template>
  <span
    ref="surface"
    class="font-text"
    :class="{ block }"
    :style="{ width: block ? '100%' : natural.width + 'px', height: displayHeight + 'px' }"
    :title="missingTitle || undefined"
  >
    <span class="font-accessible-text">{{ original }}</span
    ><canvas ref="canvas" aria-hidden="true" />
  </span>
</template>
<script setup lang="ts">
import { computed, ref, shallowRef, watch, onMounted, onScopeDispose } from 'vue';
import { getFont, loadFontAtlas, fontGlyph } from '@/app/fonts/font-provider';
import { layoutText } from '@/domain/fonts/text-layout';
import type { TextRun, FontId } from '@/domain/fonts/font.types';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
const props = withDefaults(
  defineProps<{
    text?: string;
    runs?: readonly TextRun[];
    font: FontId;
    block?: boolean;
    inkAligned?: boolean;
    outlined?: boolean;
  }>(),
  {
    text: '',
    runs: undefined,
    block: false,
    inkAligned: false,
    outlined: false,
  },
);
const surface = ref<HTMLElement | null>(null),
  canvas = ref<HTMLCanvasElement | null>(null),
  width = ref(0),
  atlas = shallowRef<HTMLImageElement | null>(null);
const reads = useQueryReadOwner(),
  feedback = useAppFeedback();
const runs = computed(() => props.runs ?? [{ text: props.text }]),
  original = computed(() => runs.value.map((run) => run.text).join(''));
const definition = computed(() => getFont(props.font));
const natural = computed(() => layoutText(definition.value, runs.value));
const layout = computed(() => (width.value ? layoutText(definition.value, runs.value, width.value) : natural.value));
const inkBounds = computed(() => layout.value.ink);
const displayHeight = computed(() => (props.inkAligned ? inkBounds.value.height : layout.value.height));
const missingTitle = computed(() =>
  layout.value.missing
    .map(
      (character) =>
        `缺字：${character} ${Array.from(character)
          .map((point) => 'U+' + point.codePointAt(0)!.toString(16).toUpperCase())
          .join(' ')}`,
    )
    .join('；'),
);
watch(
  () => props.font,
  () => {
    atlas.value = null;
    void reads.consume('font', { fontId: props.font }, () => loadFontAtlas(props.font), {
      ready: (image) => {
        atlas.value = image;
      },
      error: (error) => feedback.error(error, '读取字体失败'),
    });
  },
  { immediate: true },
);
function paint() {
  const target = canvas.value,
    element = surface.value,
    image = atlas.value;
  if (!target || !element || !image) return;
  const pixelRatio = window.devicePixelRatio,
    ink = getComputedStyle(element).color;
  const padding = props.outlined ? Math.max(1, Math.round(pixelRatio)) / pixelRatio : 0,
    offsetX = Math.min(0, inkBounds.value.left),
    offsetY = props.inkAligned ? inkBounds.value.top : Math.min(0, inkBounds.value.top);
  const right = Math.max(width.value || natural.value.width, inkBounds.value.right);
  const bottom = props.inkAligned ? inkBounds.value.bottom : Math.max(layout.value.height, inkBounds.value.bottom);
  target.width = Math.ceil((right - offsetX + padding * 2) * pixelRatio);
  target.height = Math.ceil((bottom - offsetY + padding * 2) * pixelRatio);
  target.style.width = target.width / pixelRatio + 'px';
  target.style.height = target.height / pixelRatio + 'px';
  alignPixels();
  const context = target.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  for (const item of layout.value.placements) {
    if (item.character === '\t') continue;
    context.fillStyle = item.color ?? ink;
    if (!item.glyph) {
      context.strokeStyle = item.color ?? ink;
      context.lineWidth = pixelRatio;
      context.strokeRect(
        Math.round((item.x + 1 - offsetX + padding) * pixelRatio),
        Math.round((item.y + 2 - offsetY + padding) * pixelRatio),
        Math.round((item.advance - 3) * pixelRatio),
        Math.round((definition.value.lineHeight - 4) * pixelRatio),
      );
      continue;
    }
    const glyph = item.glyph;
    const left = Math.round((item.x + glyph.xoffset - offsetX + padding) * pixelRatio),
      top = Math.round((item.y + glyph.yoffset - offsetY + padding) * pixelRatio);
    const glyphWidth = Math.round((item.x + glyph.xoffset + glyph.width - offsetX + padding) * pixelRatio) - left,
      glyphHeight = Math.round((item.y + glyph.yoffset + glyph.height - offsetY + padding) * pixelRatio) - top;
    if (props.outlined) {
      const outline = fontGlyph(image, glyph, '#000000', true);
      const stroke = Math.max(1, Math.round(pixelRatio));
      for (const [dx, dy] of [
        [-1, -1],
        [0, -1],
        [1, -1],
        [-1, 0],
        [1, 0],
        [-1, 1],
        [0, 1],
        [1, 1],
      ])
        context.drawImage(outline, 0, 0, glyph.width, glyph.height, left + dx! * stroke, top + dy! * stroke, glyphWidth, glyphHeight);
    }
    context.drawImage(fontGlyph(image, glyph, item.color ?? ink), 0, 0, glyph.width, glyph.height, left, top, glyphWidth, glyphHeight);
  }
}
function alignPixels() {
  if (!surface.value || !canvas.value) return;
  const bounds = surface.value.getBoundingClientRect(),
    ratio = window.devicePixelRatio;
  const padding = props.outlined ? Math.max(1, Math.round(ratio)) / ratio : 0;
  const left = Math.min(0, inkBounds.value.left),
    top = props.inkAligned ? 0 : Math.min(0, inkBounds.value.top);
  canvas.value.style.left = Math.round((bounds.left + left) * ratio) / ratio - bounds.left - padding + 'px';
  canvas.value.style.top = Math.round((bounds.top + top) * ratio) / ratio - bounds.top - padding + 'px';
}
let observer: ResizeObserver;
let measureFrame: number | null = null;
onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const nextWidth = entries[0]!.contentRect.width;
    if (nextWidth === width.value) return;
    if (measureFrame !== null) window.cancelAnimationFrame(measureFrame);
    measureFrame = window.requestAnimationFrame(() => {
      measureFrame = null;
      width.value = nextWidth;
      paint();
    });
  });
  observer.observe(surface.value!);
});
watch([layout, atlas, () => props.inkAligned, () => props.outlined], paint, { flush: 'post' });
window.addEventListener('resize', paint);
window.addEventListener('scroll', alignPixels, true);
onScopeDispose(() => {
  observer?.disconnect();
  if (measureFrame !== null) window.cancelAnimationFrame(measureFrame);
  window.removeEventListener('resize', paint);
  window.removeEventListener('scroll', alignPixels, true);
});
</script>
<style scoped>
.font-text {
  position: relative;
  display: inline-block;
  max-width: 100%;
  vertical-align: top;
  min-width: 0;
}
.font-text.block {
  display: block;
}
.font-text canvas {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  image-rendering: pixelated;
}
.font-accessible-text {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: pre;
}
</style>
