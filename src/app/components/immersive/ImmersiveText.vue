<template>
  <span
    ref="surface"
    class="immersive-bitmap-text"
    :class="{ block }"
    :style="{ width: block ? '100%' : natural.width + 'px', height: layout.height + 'px' }"
    :title="missingTitle || undefined"
  >
    <span class="immersive-accessible-text">{{ original }}</span
    ><canvas ref="canvas" aria-hidden="true" />
  </span>
</template>
<script setup lang="ts">
import { computed, ref, shallowRef, watch, onMounted, onScopeDispose } from 'vue';
import { IMMERSIVE_FONTS, loadImmersiveAtlas } from '@/app/immersive-fonts';
import { layoutBitmapText, type BitmapTextRun, type ImmersiveFontRole } from '@/domain/immersive/bitmap-font';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
const props = withDefaults(defineProps<{ text?: string; runs?: readonly BitmapTextRun[]; font?: ImmersiveFontRole; block?: boolean }>(), {
  text: '',
  runs: undefined,
  font: 'body',
  block: false,
});
const surface = ref<HTMLElement | null>(null),
  canvas = ref<HTMLCanvasElement | null>(null),
  width = ref(0),
  atlas = shallowRef<HTMLImageElement | null>(null);
const reads = useQueryReadOwner(),
  feedback = useAppFeedback();
const runs = computed(() => props.runs ?? [{ text: props.text }]),
  original = computed(() => runs.value.map((run) => run.text).join(''));
const natural = computed(() => layoutBitmapText(IMMERSIVE_FONTS[props.font], runs.value));
const layout = computed(() => layoutBitmapText(IMMERSIVE_FONTS[props.font], runs.value, width.value || Infinity));
const missingTitle = computed(() =>
  layout.value.missing.map((character) => `缺字：${character} U+${character.codePointAt(0)!.toString(16).toUpperCase()}`).join('；'),
);
watch(
  () => props.font,
  () => {
    atlas.value = null;
    void reads.consume('font', { role: props.font }, () => loadImmersiveAtlas(props.font), {
      ready: (image) => {
        atlas.value = image;
      },
      error: (error) => feedback.error(error, '读取内置字库失败'),
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
  const inkHeight = Math.max(
    layout.value.height,
    ...layout.value.placements.map((item) => item.y + (item.glyph ? item.glyph.yoffset + item.glyph.height : 0)),
  );
  target.width = Math.ceil((width.value || natural.value.width || 1) * pixelRatio);
  target.height = Math.ceil(inkHeight * pixelRatio);
  target.style.width = target.width / pixelRatio + 'px';
  target.style.height = target.height / pixelRatio + 'px';
  alignPixels();
  const context = target.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  const scratch = document.createElement('canvas'),
    scratchContext = scratch.getContext('2d')!;
  for (const item of layout.value.placements) {
    if (item.character === '\t') continue;
    context.fillStyle = item.color ?? ink;
    if (!item.glyph) {
      context.strokeStyle = item.color ?? ink;
      context.lineWidth = pixelRatio;
      context.strokeRect(
        Math.round((item.x + 1) * pixelRatio),
        Math.round((item.y + 2) * pixelRatio),
        Math.round((item.advance - 3) * pixelRatio),
        Math.round((IMMERSIVE_FONTS[props.font].lineHeight - 4) * pixelRatio),
      );
      continue;
    }
    const glyph = item.glyph;
    scratch.width = Math.max(1, glyph.width);
    scratch.height = Math.max(1, glyph.height);
    scratchContext.drawImage(image, glyph.x, glyph.y, glyph.width, glyph.height, 0, 0, glyph.width, glyph.height);
    scratchContext.globalCompositeOperation = 'multiply';
    scratchContext.fillStyle = item.color ?? ink;
    scratchContext.fillRect(0, 0, glyph.width, glyph.height);
    scratchContext.globalCompositeOperation = 'destination-in';
    scratchContext.drawImage(image, glyph.x, glyph.y, glyph.width, glyph.height, 0, 0, glyph.width, glyph.height);
    const left = Math.round((item.x + glyph.xoffset) * pixelRatio),
      top = Math.round((item.y + glyph.yoffset) * pixelRatio);
    context.drawImage(
      scratch,
      0,
      0,
      glyph.width,
      glyph.height,
      left,
      top,
      Math.round((item.x + glyph.xoffset + glyph.width) * pixelRatio) - left,
      Math.round((item.y + glyph.yoffset + glyph.height) * pixelRatio) - top,
    );
  }
}
function alignPixels() {
  if (!surface.value || !canvas.value) return;
  const bounds = surface.value.getBoundingClientRect(),
    ratio = window.devicePixelRatio;
  canvas.value.style.left = Math.round(bounds.left * ratio) / ratio - bounds.left + 'px';
  canvas.value.style.top = Math.round(bounds.top * ratio) / ratio - bounds.top + 'px';
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
watch([layout, atlas], paint, { flush: 'post' });
window.addEventListener('resize', paint);
window.addEventListener('scroll', alignPixels, true);
onScopeDispose(() => {
  observer?.disconnect();
  if (measureFrame !== null) window.cancelAnimationFrame(measureFrame);
  window.removeEventListener('resize', paint);
  window.removeEventListener('scroll', alignPixels, true);
});
</script>
