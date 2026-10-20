import { computed, onMounted, onUnmounted, reactive, shallowRef, watch, type ShallowRef } from 'vue';
import type { DeepReadonly, RowData, WeaponFirePreviewData } from '@/shared/types';
import { arr, str } from '@/shared/lib/starsector';
import type { WeaponViewMode } from '@/domain/editors/lib/weapon-sprite-fields';
import { createWeaponFirePreviewDefinition, type WeaponFirePreviewDefinition } from '@/domain/weapon-fire-preview/preview-definition';
import {
  createWeaponFirePreviewState,
  startWeaponFirePreview,
  stopWeaponFirePreview,
  advanceWeaponFirePreview,
  weaponGlowLevel,
} from '@/domain/weapon-fire-preview/simulation';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { useCanvasSurface, watchCanvasPixelRatio } from '@/app/composables/canvas/use-canvas-surface';
import { useCanvasPalette } from '@/app/composables/canvas/use-canvas-palette';
import { useProjectileRendering } from '../editors/use-projectile-rendering';
import { useEngineRendering } from '../editors/use-engine-rendering';
import { useEditorFrameLoop } from '../editors/use-editor-frame-loop';
import { renderWeaponFirePreviewScene } from '@/app/renderers/weapon-fire-preview/scene';

export interface WeaponFirePreviewProps {
  sessionId: string;
  weaponId: string;
  weaponCsvRow: DeepReadonly<RowData>;
  weaponSpec: DeepReadonly<RowData>;
  projectile: DeepReadonly<RowData> | null;
  resources: WeaponFirePreviewData['resources'];
}
export type WeaponFirePreviewEvents = { close: [] };
export function useWeaponFirePreviewViewModel(
  props: Readonly<WeaponFirePreviewProps>,
  elements: { canvasRef: Readonly<ShallowRef<HTMLCanvasElement | null>>; previewStageRef: Readonly<ShallowRef<HTMLElement | null>> },
) {
  const { canvasRef, previewStageRef } = elements,
    surface = useCanvasSurface(canvasRef);
  const state = shallowRef(createWeaponFirePreviewState()),
    viewMode = computed(() => state.value.mode);
  const definition = computed(() =>
    createWeaponFirePreviewDefinition(props.weaponCsvRow, props.weaponSpec, props.projectile ?? {}, viewMode.value, props.resources),
  );
  const sources = shallowRef<WeaponFirePreviewDefinition[]>([definition.value]);
  function synchronize() {
    const next = [
      ...new Set([
        definition.value,
        ...state.value.projectiles.map((item) => item.definition),
        ...state.value.effects.map((item) => item.definition),
      ]),
    ];
    if (next.length !== sources.value.length || next.some((item, i) => item !== sources.value[i])) sources.value = next;
  }
  const resources = computed(() =>
    sources.value.flatMap((item) => [...Object.values(item.weaponResources), ...Object.values(item.resources)]),
  );
  const images = useProjectileRendering(
    () => props.sessionId,
    () => resources.value,
    draw,
  );
  const engines = useEngineRendering(
    () => props.sessionId,
    draw,
    () => sources.value.flatMap((item) => item.appearance.engines),
  );
  const hasWeaponSpec = computed(() => Object.keys(props.weaponSpec).length > 0),
    palette = useCanvasPalette(draw),
    frames = useEditorFrameLoop(frame);
  let last = 0,
    stopDpi: (() => void) | null = null;
  function restart() {
    frames.stop();
    last = 0;
    frames.start();
  }
  function reset() {
    state.value = createWeaponFirePreviewState(state.value.mode, state.value.speed);
    synchronize();
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
      state.value = { ...state.value, mode, firingState: { ...state.value.firingState, barrel: 0 } };
      draw();
    }
  }
  function startFiring() {
    const paused = !state.value.running;
    startWeaponFirePreview(state.value);
    state.value = { ...state.value };
    if (paused) restart();
  }
  function stopFiring() {
    stopWeaponFirePreview(state.value);
    state.value = { ...state.value };
  }
  function frame(time: number) {
    if (!last) last = time;
    const dt = ((time - last) / 1000) * state.value.speed;
    last = time;
    advanceWeaponFirePreview(state.value, definition.value, dt, Math.random, engines.style);
    synchronize();
    draw();
  }
  function draw() {
    const c = canvasRef.value;
    if (!c) return;
    const origin = { x: 80, y: surface.size().height / 2 },
      scale = (surface.size().width - 140) / Math.max(definition.value.range, 100);
    images.paint((providers) =>
      engines.paint((engineImages) => {
        const color = arr(props.weaponSpec.glowColor, [255, 255, 255, 255]),
          weaponImages = new Map<string, HTMLImageElement>();
        color[3] = color[3]! * weaponGlowLevel(state.value, definition.value);
        for (const [key, resource] of Object.entries(props.resources.weapon)) {
          const image = images.image(resource);
          if (image) weaponImages.set(key, image);
        }
        const glowKey = state.value.mode === 'turret' ? 'turretGlowSprite' : 'hardpointGlowSprite';
        renderWeaponFirePreviewScene(c.getContext('2d')!, {
          size: surface.size(),
          palette: palette.value,
          definition: definition.value,
          origin,
          range: definition.value.range * scale,
          scale,
          hasWeaponSpec: hasWeaponSpec.value,
          assets: {
            images: weaponImages,
            weapon: props.weaponSpec,
            mode: state.value.mode,
            scale,
            center: origin,
            glowColor: color,
            glowTint: color[3]! > 0 ? (providers(props.resources.weapon).image(glowKey, color) as HTMLCanvasElement | null) : null,
          },
          projectiles: state.value.projectiles,
          beam: state.value.beam,
          effects: state.value.effects,
          images: providers,
          engineImages,
        });
      }),
    );
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
  watch(
    () => props.sessionId,
    () => {
      state.value = createWeaponFirePreviewState(state.value.mode, state.value.speed);
      synchronize();
      draw();
    },
  );
  watch(
    definition,
    () => {
      synchronize();
      draw();
    },
    { flush: 'post' },
  );
  watch(() => [props.weaponSpec.glowColor, props.weaponSpec.renderHints], draw, { flush: 'post' });
  return {
    view: reactive({
      running: computed(() => state.value.running),
      firing: computed(() => state.value.firing),
      speed: computed(() => state.value.speed),
      viewMode,
      hasWeaponSpec,
      mediaReady: images.ready,
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
