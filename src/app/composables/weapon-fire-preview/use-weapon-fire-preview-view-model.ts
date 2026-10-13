import { computed, onMounted, onUnmounted, reactive, shallowRef, watch, type ShallowRef } from 'vue';
import type { DeepReadonly, RowData } from '@/shared/types';
import { arr, str } from '@/shared/lib/starsector';
import type { WeaponViewMode } from '@/domain/editors/lib/weapon-sprite-fields';
import {
  createWeaponFirePreviewParams,
  createWeaponFirePreviewState,
  startWeaponFirePreview,
  stopWeaponFirePreview,
  advanceWeaponFirePreview,
  weaponFirePreviewBarrels,
} from '@/domain/weapon-fire-preview/simulation';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { useCanvasSurface, watchCanvasPixelRatio } from '@/app/composables/canvas/use-canvas-surface';
import { useCanvasPalette } from '@/app/composables/canvas/use-canvas-palette';
import { useEditorImages } from '../editors/use-editor-images';
import { useEditorFrameLoop } from '../editors/use-editor-frame-loop';
import { renderWeaponFirePreviewScene } from '@/app/renderers/weapon-fire-preview/scene';
export interface WeaponFirePreviewProps {
  weaponId: string;
  weaponCsvRow: DeepReadonly<RowData>;
  weaponSpec: DeepReadonly<RowData>;
  projectileSpecs: DeepReadonly<Record<string, RowData>>;
  spriteData?: Record<string, string>;
}
export type WeaponFirePreviewEvents = { close: [] };
export function useWeaponFirePreviewViewModel(
  props: Readonly<WeaponFirePreviewProps>,
  elements: {
    canvasRef: Readonly<ShallowRef<HTMLCanvasElement | null>>;
    previewStageRef: Readonly<ShallowRef<HTMLElement | null>>;
  },
) {
  const { canvasRef, previewStageRef } = elements,
    surface = useCanvasSurface(canvasRef);
  const state = shallowRef(createWeaponFirePreviewState(createWeaponFirePreviewParams(props.weaponCsvRow, props.weaponSpec, {}, 'turret')));
  const viewMode = computed(() => state.value.mode);
  const params = computed(() =>
    createWeaponFirePreviewParams(
      props.weaponCsvRow,
      props.weaponSpec,
      props.projectileSpecs[str(props.weaponSpec.projectileSpecId)] || {},
      viewMode.value,
    ),
  );
  const hasWeaponSpec = computed(() => Object.keys(props.weaponSpec).length > 0),
    palette = useCanvasPalette(draw);
  const frames = useEditorFrameLoop(frame),
    images = useEditorImages(() => props.spriteData ?? {}, draw);
  let last = 0,
    stopDpi: (() => void) | null = null;
  const origin = () => ({ x: 80, y: canvasRef.value ? surface.size().height / 2 : 0 });
  const scale = () => (canvasRef.value ? (surface.size().width - 140) / Math.max(params.value.range, 100) : 0.5);
  function restart() {
    frames.stop();
    last = 0;
    frames.start();
  }
  function reset() {
    state.value = createWeaponFirePreviewState(params.value, state.value.mode, state.value.speed);
    restart();
    draw();
  }
  function toggle() {
    state.value = { ...state.value, running: !state.value.running };
    if (state.value.running) restart();
    else frames.stop();
  }
  function setView(mode: WeaponViewMode) {
    if (hasWeaponSpec.value) {
      state.value = { ...state.value, mode, barrelIndex: 0 };
      draw();
    }
  }
  function startFiring() {
    const paused = !state.value.running;
    state.value = startWeaponFirePreview(state.value, params.value);
    if (paused) restart();
  }
  function stopFiring() {
    state.value = stopWeaponFirePreview(state.value, params.value);
  }
  function frame(time: number) {
    if (!last) last = time;
    const dt = Math.min(((time - last) / 1000) * state.value.speed, 0.1);
    last = time;
    state.value = advanceWeaponFirePreview(state.value, params.value, dt, origin(), scale(), Math.random);
    draw();
  }
  function draw() {
    const c = canvasRef.value;
    if (!c) return;
    const color = arr(props.weaponSpec.glowColor, [255, 255, 255, 255]),
      glow = images.images.get(state.value.mode === 'turret' ? 'turretGlowSprite' : 'hardpointGlowSprite');
    renderWeaponFirePreviewScene(c.getContext('2d')!, {
      size: surface.size(),
      palette: palette.value,
      params: params.value,
      origin: origin(),
      range: params.value.range * scale(),
      scale: scale(),
      hasWeaponSpec: hasWeaponSpec.value,
      assets: {
        images: images.images,
        weapon: props.weaponSpec,
        mode: state.value.mode,
        scale: scale(),
        center: origin(),
        glowColor: color,
        glowTint: glow && color[3]! > 0 ? images.tintImage(glow, color) : null,
      },
      barrels: weaponFirePreviewBarrels(params.value, origin(), scale()),
      projectiles: state.value.projectiles,
      beam: state.value.beam,
    });
  }
  function resize() {
    const rect = previewStageRef.value?.getBoundingClientRect();
    surface.resize(rect?.width, rect?.height);
    draw();
  }
  useShortcutDispatch({ keys: { u: () => setView('turret'), h: () => setView('hardpoint') } });
  onMounted(() => {
    stopDpi = watchCanvasPixelRatio(resize);
    resize();
    window.addEventListener('resize', resize);
    reset();
  });
  onUnmounted(() => {
    stopDpi?.();
    window.removeEventListener('resize', resize);
  });
  watch(() => [params.value, props.weaponSpec.glowColor, props.weaponSpec.renderHints], draw, { flush: 'post' });
  return {
    view: reactive({
      running: computed(() => state.value.running),
      firing: computed(() => state.value.firing),
      speed: computed(() => state.value.speed),
      viewMode,
      hasWeaponSpec,
      previewSubtitle: computed(() => '武器 ' + props.weaponId + ' · 弹体 ' + (str(props.weaponSpec.projectileSpecId) || '-')),
      speedLabel: computed(() => state.value.speed.toFixed(1) + 'x'),
    }),
    actions: {
      reset,
      toggle,
      setView,
      startFiring,
      stopFiring,
      setSpeed: (speed: number) => {
        state.value = { ...state.value, speed };
      },
    },
  };
}
