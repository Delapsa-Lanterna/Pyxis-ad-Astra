<template>
  <div ref="stage" class="variant-scene" :tabindex="iconSize ? undefined : 0" @keydown.enter.prevent="activateSelected" @keydown="navigate">
    <canvas
      ref="canvas"
      role="img"
      :aria-label="variant.name + ' 舰船与槽位预览'"
      @mousedown="down"
      @mousemove="move"
      @mouseup="navigation.finish"
      @mouseleave="leave"
      @wheel.prevent="navigation.wheel"
      @contextmenu.prevent
    />
    <div
      v-if="!iconSize && hoverWeapon"
      class="variant-slot-label"
      :style="{ left: point(hoverWeapon.slot).x + 'px', top: point(hoverWeapon.slot).y + 20 + 'px' }"
    >
      <ImmersiveText :text="(hoverWeapon.name || '空槽') + (hoverWeapon.builtin ? '（内置）' : '')" font="slot-name" />
    </div>
  </div>
</template>
<script setup lang="ts">
import { weaponSlotStyle } from '@/app/renderers/editors/canvas-styles';
import { computed, ref, shallowRef, watch, onMounted, onScopeDispose } from 'vue';
import type { ImmersiveHullProjection } from '@/domain/immersive/hull-scene';
import { schemaStringValue } from '@/domain/schema/schema-values';
import { isRowData } from '@/shared/lib/row-data';
import { useCanvasViewport } from '@/app/composables/canvas/use-canvas-viewport';
import { clearCanvas, drawPixelImage } from '@/app/renderers/editors/canvas-drawing';
import { useCanvasNavigation } from '@/app/composables/canvas/use-canvas-navigation';
import { useCanvasSelection } from '@/app/composables/canvas/use-canvas-selection';
import { createCanvasState } from '@/app/composables/canvas/use-canvas-state';
import { watchCanvasPixelRatio } from '@/app/composables/canvas/use-canvas-surface';
import { drawWeaponSlotVisual } from '@/app/renderers/editors/canvas-visuals';
import { renderMountedWeapons } from '@/app/renderers/editors/weapon-images';
import { drawWeaponMount } from '@/app/renderers/immersive/weapon-mount';
import { immersiveHullPoint, type ImmersiveWingLayout } from '@/domain/immersive/hull-scene';
import { IMMERSIVE_COLORS } from '@/domain/immersive/appearance';
import { useResourceImages } from '@/app/composables/use-resource-images';
import { windowImageCache } from '@/app/composables/use-window-image-cache';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useResourceMediaRegistry } from '@/app/composables/use-resource-media-registry';
import { warningNotice } from '@/shared/lib/errors';
import type { ResourceRef } from '@/shared/types';
import ImmersiveText from './ImmersiveText.vue';
const props = defineProps<{
  variant: ImmersiveHullProjection;
  sessionId: string;
  iconSize?: number;
  wingLayout?: ImmersiveWingLayout;
  resourceUrl?: (resource: import('@/shared/types').ResourceRef) => string;
}>();
const emit = defineEmits<{ slot: [index: number, anchor: { x: number; y: number }]; module: [key: string]; blank: [] }>();
const canvas = shallowRef<HTMLCanvasElement | null>(null),
  stage = ref<HTMLElement | null>(null);
const viewport = useCanvasViewport(canvas, 1, 4),
  feedback = useAppFeedback();
const state = createCanvasState<null>();
const hoverWeapon = computed(() => (state.hovered.value ? props.variant.weapons[state.hovered.value.i] : null));
const navigation = useCanvasNavigation(
  {
    ...viewport,
    zoom: (delta) => {
      const maximum = ({ FIGHTER: 2, FRIGATE: 2, DESTROYER: 2, CRUISER: 1.75, CAPITAL_SHIP: 1.5 } as Record<string, number>)[
        String(props.variant.spec.hullSize)
      ]!;
      const minimum = Math.min(1, 500 / Number(props.variant.spec.width), 500 / Number(props.variant.spec.height));
      viewport.scale.value = Math.max(minimum, Math.min(maximum, viewport.scale.value + (delta < 0 ? 0.25 : -0.25)));
    },
  },
  paint,
);
const media = props.resourceUrl
  ? null
  : useResourceMediaRegistry({
      surface: '装配网格',
      onError: (error) => feedback.error(error),
      onFailures: (resources) =>
        feedback.warning(
          warningNotice(
            '装配贴图读取失败：' + resources.map((resource) => resource.relPath).join('、'),
            'resource.read_failed',
            'Variant scene resource decode',
          ),
        ),
    });
function sceneVariants(root: ImmersiveHullProjection, visited = new Set<string>()): ImmersiveHullProjection[] {
  if (visited.has(root.key)) return [];
  visited.add(root.key);
  return [root, ...root.modules.flatMap((module) => sceneVariants(module.variant, visited))];
}
const resources = () =>
  sceneVariants(props.variant).flatMap((variant) => [
    ...(variant.hull.sprite ? [variant.hull.sprite] : []),
    ...Object.values(variant.engineResources).filter((resource) => resource.key.startsWith('engine')),
    ...variant.weapons.flatMap((weapon) => [
      ...weapon.layers.map((layer) => layer.resource),
      ...(weapon.loadedMissile ? [weapon.loadedMissile.resource] : []),
    ]),
  ]);
watch(
  resources,
  (items) => {
    if (media) void media.replaceCollection(props.sessionId, 'scene', items);
  },
  { immediate: true },
);
const url = (resource: import('@/shared/types').ResourceRef) =>
  props.resourceUrl ? props.resourceUrl(resource) : (media!.dataUrl(props.sessionId, resource) ?? '');
const decoded = useResourceImages(
  () => props.sessionId,
  () => resources().map((resource) => ({ resource, url: url(resource) })),
  paint,
  (error) => feedback.error(error, '读取装配预览失败'),
);
const imageCache = windowImageCache();
let releaseThumbnail: (() => void) | null = null;
const engineTints = new Map<string, { canvas: HTMLCanvasElement; release: () => void }>();
const paintedTints = new Set<string>();
function engineTint(resource: ResourceRef, image: HTMLImageElement, color: unknown[]) {
  const key = JSON.stringify([
    'engine-source-atop',
    imageCache.key(props.sessionId, resource),
    imageCache.revision(props.sessionId, resource),
    image.width,
    image.height,
    color.slice(0, 3),
  ]);
  paintedTints.add(key);
  let entry = engineTints.get(key);
  if (!entry) {
    let tinted = imageCache.thumbnail(key);
    let release: () => void;
    if (tinted) release = imageCache.retainThumbnail(key);
    else {
      tinted = document.createElement('canvas');
      tinted.width = image.width;
      tinted.height = image.height;
      const paint = tinted.getContext('2d')!;
      paint.drawImage(image, 0, 0);
      paint.globalCompositeOperation = 'source-atop';
      paint.fillStyle = 'rgb(' + color.slice(0, 3).join(',') + ')';
      paint.fillRect(0, 0, image.width, image.height);
      release = imageCache.storeThumbnail(key, props.sessionId, [resource], tinted);
    }
    entry = { canvas: tinted, release };
    engineTints.set(key, entry);
  }
  return entry.canvas;
}
const sceneSignature = computed(() =>
  JSON.stringify([
    'scene',
    props.sessionId,
    props.iconSize,
    props.wingLayout,
    sceneVariants(props.variant).map((variant) => [
      variant.spec.center,
      variant.hull.sprite,
      variant.weapons.map((weapon) => [
        weapon.slot.locations,
        weapon.slot.angle,
        weapon.slot.type,
        weapon.renderOrder,
        weapon.additive,
        weapon.layers.map((layer) => [imageCache.key(props.sessionId, layer.resource), layer.origin, layer.phase]),
        weapon.loadedMissile,
      ]),
      variant.modules.map((module) => [module.slot.locations, module.slot.angle, module.variant.spec.moduleAnchor]),
    ]),
    resources().map((resource) => imageCache.revision(props.sessionId, resource)),
  ]),
);
function thumbnailKey() {
  return sceneSignature.value + '/' + window.devicePixelRatio;
}
const point = (slot: import('@/shared/types').DeepReadonly<import('@/shared/types').RowData>) => {
  const location = Array.isArray(slot.locations) ? slot.locations : [0, 0];
  return viewport.toCanvas('ship', -Number(location[1]), Number(location[0]));
};
const selection = useCanvasSelection(
  state,
  (x, y) =>
    props.variant.weapons.map((weapon, i) => {
      const p = point(weapon.slot);
      return { kind: 'slot', i, distance: Math.hypot(x - p.x, y - p.y) };
    }),
  () => 24,
  false,
);
function paint() {
  const surface = canvas.value;
  if (!surface) return;
  paintedTints.clear();
  const ctx = surface.getContext('2d')!,
    size = viewport.size(),
    center = viewport.center(),
    scale = viewport.scale.value;
  clearCanvas(ctx, size.width, size.height, IMMERSIVE_COLORS.background);
  const cached = props.iconSize ? imageCache.thumbnail(thumbnailKey()) : null;
  const nextRelease = cached ? imageCache.retainThumbnail(thumbnailKey()) : null;
  releaseThumbnail?.();
  releaseThumbnail = null;
  if (cached) {
    releaseThumbnail = nextRelease;
    drawPixelImage(ctx, cached, 0, 0, size.width, size.height);
    return;
  }
  if (!props.iconSize) {
    ctx.strokeStyle = 'rgba(70,200,255,0.2941176471)';
    ctx.lineWidth = 1 / window.devicePixelRatio;
    for (let x = (size.width % 25) / 2; x < size.width; x += 25) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, size.height);
      ctx.stroke();
    }
    for (let y = (size.height % 25) / 2; y < size.height; y += 25) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size.width, y);
      ctx.stroke();
    }
  }
  ctx.save();
  ctx.translate(center.x, center.y);
  if (props.wingLayout) {
    const image = props.variant.hull.sprite ? decoded.image(props.variant.hull.sprite) : null;
    const origin = Array.isArray(props.variant.spec.center) ? props.variant.spec.center : [0, 0];
    const fighterScale = props.wingLayout.spriteHeight / (image?.height ?? Number(props.variant.spec.height));
    for (const point of props.wingLayout.points) {
      ctx.save();
      ctx.translate(point.x, point.y);
      ctx.scale(fighterScale, fighterScale);
      if (image) ctx.translate(Number(origin[0]) - image.width / 2, image.height / 2 - Number(origin[1]));
      drawVariant(ctx, props.variant, new Set());
      ctx.restore();
    }
  } else {
    ctx.scale(scale, scale);
    drawVariant(ctx, props.variant, new Set());
  }
  ctx.restore();
  for (const [key, entry] of engineTints)
    if (!paintedTints.has(key)) {
      entry.release();
      engineTints.delete(key);
    }
  if (props.iconSize && decoded.ready() && resources().length) {
    const finished = document.createElement('canvas');
    finished.width = surface.width;
    finished.height = surface.height;
    finished.getContext('2d')!.drawImage(surface, 0, 0);
    const key = thumbnailKey();
    releaseThumbnail = imageCache.storeThumbnail(key, props.sessionId, resources(), finished);
  }
}
function drawVariant(ctx: CanvasRenderingContext2D, variant: ImmersiveHullProjection, parents: Set<string>) {
  if (parents.has(variant.key)) return;
  const nextParents = new Set([...parents, variant.key]);
  const sprite = variant.hull.sprite,
    image = sprite ? decoded.image(sprite) : null;
  const hullCenter = Array.isArray(variant.spec.center) ? variant.spec.center : [0, 0];
  if (!props.iconSize) drawEngines(ctx, variant);
  if (image) drawPixelImage(ctx, image, -Number(hullCenter[0]), -(image.height - Number(hullCenter[1])), image.width, image.height);
  // ShipDisplayPanel refit passes differ from the ship editor's combat order.
  renderMountedWeapons(ctx, {
    weapons: variant.weapons,
    image: (resource) => decoded.image(resource) ?? undefined,
    point: (slot) => immersiveHullPoint((Array.isArray(slot.locations) ? slot.locations : [0, 0]).map(Number)),
    rotation: (slot) => (-Number(slot.angle ?? 0) * Math.PI) / 180,
    scale: 1,
    context: 'refit',
    renderModules: () => {
      for (const module of variant.modules) {
        const location = Array.isArray(module.slot.locations) ? module.slot.locations : [0, 0];
        const anchor = Array.isArray(module.variant.spec.moduleAnchor) ? module.variant.spec.moduleAnchor : [0, 0];
        ctx.save();
        const position = immersiveHullPoint(location.map(Number));
        ctx.translate(position.x, position.y);
        ctx.rotate((-Number(module.slot.angle ?? 0) * Math.PI) / 180);
        const attachment = immersiveHullPoint(anchor.map(Number));
        ctx.translate(-attachment.x, -attachment.y);
        drawVariant(ctx, module.variant, nextParents);
        ctx.restore();
      }
    },
  });
  for (const [index, weapon] of variant.weapons.entries()) {
    const location = Array.isArray(weapon.slot.locations) ? weapon.slot.locations : [0, 0];
    const p = immersiveHullPoint(location.map(Number)),
      slot = weapon.slot;
    if (props.iconSize || slot.type === 'DECORATIVE' || slot.type === 'LAUNCH_BAY' || slot.type === 'SYSTEM' || slot.mount === 'HIDDEN')
      continue;
    const active = variant.key === props.variant.key && (state.selected.value === index || state.hovered.value?.i === index);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(active ? 0.66 : 0.44, active ? 0.66 : 0.44);
    drawWeaponMount(ctx, schemaStringValue(slot.type), schemaStringValue(slot.size), (weapon.id ? 0.3 : 0.5) * (active ? 1 : 0.25));
    ctx.restore();
    if (active)
      drawWeaponSlotVisual(ctx, {
        point: p,
        angle: Number(slot.angle ?? 0) + 90,
        arc: Number(slot.arc ?? 0),
        mount: schemaStringValue(slot.mount),
        type: schemaStringValue(slot.type),
        size: schemaStringValue(slot.size),
        style: weaponSlotStyle(schemaStringValue(slot.type), variant.key === props.variant.key && state.selected.value === index ? 1 : 0.6),
      });
  }
}
function drawEngines(ctx: CanvasRenderingContext2D, variant: ImmersiveHullProjection) {
  const slots = Array.isArray(variant.spec.engineSlots) ? variant.spec.engineSlots.filter(isRowData) : [];
  for (const engine of slots) {
    const style = engine.style === 'CUSTOM' && isRowData(engine.styleSpec) ? engine.styleSpec : variant.engineStyles[String(engine.style)];
    if (!isRowData(style) || !Array.isArray(style.engineColor)) continue;
    const color = style.engineColor,
      position = immersiveHullPoint(engine.location as number[]);
    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate(((-Number(engine.angle) - 90) * Math.PI) / 180);
    ctx.globalCompositeOperation = 'lighter';
    for (const [key, width, height, alpha] of [
      ['engineGlow', Number(engine.length) * 0.5, Number(engine.width), 0.6],
      ['engineFlame', Number(engine.length) * 0.45, Number(engine.width), 0.6],
      ['engineHitGlow', Number(engine.width) * 2, Number(engine.width) * 2, 0.6],
    ] as const) {
      const resource = variant.engineResources[key],
        image = resource ? decoded.image(resource) : null;
      if (!image) continue;
      ctx.globalAlpha = alpha;
      ctx.drawImage(engineTint(resource!, image, color), key === 'engineHitGlow' ? -width / 2 : 0, -height / 2, width, height);
    }
    ctx.restore();
  }
}
function activateSelected() {
  const index = state.selected.value;
  if (index === null) return;
  const weapon = props.variant.weapons[index]!;
  if (weapon.slot.type === 'STATION_MODULE') {
    const module = props.variant.hull.modules.find((item) => item.slotId === weapon.slot.id);
    if (module) emit('module', module.variantKey);
  } else {
    const position = point(weapon.slot),
      bounds = canvas.value!.getBoundingClientRect();
    emit('slot', index, { x: bounds.left + position.x, y: bounds.top + position.y });
  }
}
function navigate(event: KeyboardEvent) {
  const direction = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[event.key];
  if (!direction) return;
  event.preventDefault();
  event.stopPropagation();
  const items = props.variant.weapons
    .map((weapon, index) => ({ weapon, index }))
    .filter(({ weapon }) => !['SYSTEM', 'DECORATIVE', 'LAUNCH_BAY'].includes(schemaStringValue(weapon.slot.type)));
  const current = items.findIndex(({ index }) => index === state.selected.value);
  const next = items[(current + direction + items.length) % items.length];
  if (next) {
    selection.byIdentity({ kind: 'slot', i: next.index }, 0, 0);
    paint();
  }
}
function down(event: MouseEvent) {
  stage.value!.focus({ preventScroll: true });
  if (navigation.start(event) || event.button !== 0) return;
  if (selection.byPointer(event.offsetX, event.offsetY)) activateSelected();
  else emit('blank');
  paint();
}
function move(event: MouseEvent) {
  if (navigation.move(event)) return;
  selection.byPointer(event.offsetX, event.offsetY);
  paint();
}
function leave() {
  navigation.finish();
  state.leave();
  paint();
}
function resize() {
  const bounds = stage.value!.getBoundingClientRect();
  viewport.resize(bounds.width, bounds.height);
  paint();
}
function fit() {
  const width = Number(props.variant.spec.width ?? 200),
    height = Number(props.variant.spec.height ?? 200);
  const size = viewport.size();
  viewport.scale.value = props.iconSize
    ? 1
    : Math.min(1, 500 / width, 500 / height, (size.width - 400) / width, (size.height - 70) / height);
  viewport.pan.value = { x: 0, y: 0 };
  state.reset();
  paint();
}
watch(() => props.variant.key, fit);
watch(() => [props.variant, props.wingLayout], paint, { flush: 'post' });
let observer: ResizeObserver, stopRatio: () => void;
onMounted(() => {
  observer = new ResizeObserver(resize);
  observer.observe(stage.value!);
  stopRatio = watchCanvasPixelRatio(resize);
  resize();
  fit();
});
onScopeDispose(() => {
  releaseThumbnail?.();
  for (const entry of engineTints.values()) entry.release();
  engineTints.clear();
  observer?.disconnect();
  stopRatio?.();
  navigation.finish();
});
defineExpose({ fit });
</script>
