<template>
  <span
    ref="surface"
    class="font-text ui-layout-shrink ui-text-wrap"
    :class="{ block, 'font-default': !font, outlined }"
    :style="
      font
        ? { width: block ? '100%' : natural!.width + 'px', height: displayHeight + 'px' }
        : { fontSize: fallback.size + 'px', fontWeight: fallback.weight }
    "
    :title="missingTitle || undefined"
  >
    <template v-if="font"
      ><span class="font-accessible-text ui-layout-clip">{{ original }}</span
      ><canvas class="font-text-canvas" ref="canvas" aria-hidden="true"
    /></template>
    <template v-else
      ><span v-for="(run, index) in runs" :key="index" :style="{ color: run.color }">{{ run.text }}</span></template
    >
  </span>
</template>
<script setup lang="ts">
import { computed, ref, watch, onMounted, onScopeDispose } from 'vue';
import { fontGlyph } from '@/app/fonts/font-provider';
import { useOriginalFont } from '@/app/composables/use-original-fonts';
import { fontDefaultStyles } from '@/domain/fonts/font-styles';
import { layoutText } from '@/domain/fonts/text-layout';
import type { TextRun, FontId } from '@/domain/fonts/font.types';
import { queueTextPaint, registerTextSurface, type TextSurface } from '@/app/fonts/text-surface-scheduler';
const props = withDefaults(
  defineProps<{
    text?: string;
    runs?: readonly TextRun[];
    font: FontId;
    block?: boolean;
    inkAligned?: boolean;
    outlined?: boolean;
    active?: boolean;
  }>(),
  {
    text: '',
    runs: undefined,
    block: false,
    inkAligned: false,
    outlined: false,
    active: true,
  },
);
const surface = ref<HTMLElement | null>(null),
  canvas = ref<HTMLCanvasElement | null>(null),
  width = ref(0);
const font = useOriginalFont(() => props.font);
const fallback = computed(() => fontDefaultStyles[props.font]);
const runs = computed(() => props.runs ?? [{ text: props.text }]),
  original = computed(() => runs.value.map((run) => run.text).join(''));
const definition = computed(() => font.value?.definition ?? null);
const natural = computed(() => (definition.value ? layoutText(definition.value, runs.value) : null));
const layout = computed(() => (definition.value && width.value ? layoutText(definition.value, runs.value, width.value) : natural.value));
const inkBounds = computed(() => layout.value?.ink);
const displayHeight = computed(() => (layout.value ? (props.inkAligned ? inkBounds.value!.height : layout.value.height) : 0));
const missingTitle = computed(() =>
  (layout.value?.missing ?? [])
    .map(
      (character) =>
        `缺字：${character} ${Array.from(character)
          .map((point) => 'U+' + point.codePointAt(0)!.toString(16).toUpperCase())
          .join(' ')}`,
    )
    .join('；'),
);
let textSurface: TextSurface | null = null;
let lastPaint: { canvas: HTMLCanvasElement; signature: string } | null = null;
watch(font, () => {
  lastPaint = null;
});
function paint() {
  if (textSurface && props.active) queueTextPaint(textSurface);
}
function paintNow() {
  const target = canvas.value,
    element = surface.value,
    loaded = font.value;
  if (!target || !element || !loaded) return;
  const pixelRatio = window.devicePixelRatio,
    ink = getComputedStyle(element).color;
  const signature = JSON.stringify([runs.value, width.value, pixelRatio, ink, props.outlined, props.inkAligned]);
  if (lastPaint?.canvas === target && lastPaint.signature === signature) return;
  const padding = props.outlined ? Math.max(1, Math.round(pixelRatio)) / pixelRatio : 0,
    offsetX = Math.min(0, inkBounds.value!.left),
    offsetY = props.inkAligned ? inkBounds.value!.top : Math.min(0, inkBounds.value!.top);
  const right = Math.max(width.value || natural.value!.width, inkBounds.value!.right);
  const bottom = props.inkAligned ? inkBounds.value!.bottom : Math.max(layout.value!.height, inkBounds.value!.bottom);
  target.width = Math.ceil((right - offsetX + padding * 2) * pixelRatio);
  target.height = Math.ceil((bottom - offsetY + padding * 2) * pixelRatio);
  target.style.width = target.width / pixelRatio + 'px';
  target.style.height = target.height / pixelRatio + 'px';
  const context = target.getContext('2d')!;
  context.imageSmoothingEnabled = false;
  for (const item of layout.value!.placements) {
    if (item.character === '\t') continue;
    context.fillStyle = item.color ?? ink;
    const glyph = item.glyph!;
    const image = loaded.pages.get(glyph.page)!;
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
  lastPaint = { canvas: target, signature };
}
function alignPixels() {
  if (!surface.value || !canvas.value || !inkBounds.value) return;
  const bounds = surface.value.getBoundingClientRect(),
    ratio = window.devicePixelRatio;
  const padding = props.outlined ? Math.max(1, Math.round(ratio)) / ratio : 0;
  const left = Math.min(0, inkBounds.value.left),
    top = props.inkAligned ? 0 : Math.min(0, inkBounds.value.top);
  const horizontal = Math.round((bounds.left + left) * ratio) / ratio - bounds.left - padding + 'px';
  const vertical = Math.round((bounds.top + top) * ratio) / ratio - bounds.top - padding + 'px';
  return () => {
    canvas.value!.style.left = horizontal;
    canvas.value!.style.top = vertical;
  };
}
let release: (() => void) | null = null;
onMounted(() => {
  textSurface = {
    element: surface.value!,
    resize: (next) => {
      if (next !== width.value) width.value = next;
    },
    paint: paintNow,
    align: alignPixels,
  };
  watch(
    () => props.active,
    (active) => {
      release?.();
      release = active ? registerTextSurface(textSurface!) : null;
    },
    { immediate: true, flush: 'sync' },
  );
});
watch([layout, font, () => props.inkAligned, () => props.outlined], paint, { flush: 'post' });
onScopeDispose(() => release?.());
</script>
