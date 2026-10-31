import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch, type ShallowRef } from 'vue';
import type { DeepReadonly, RowData, WeaponFirePreviewData } from '@/shared/types';
import { arr, str } from '@/shared/lib/starsector';
import type { WeaponViewMode } from '@/shared/lib/starsector/weapon-sprite-fields';
import { createWeaponFirePreviewDefinition, type WeaponFirePreviewDefinition } from '@/domain/weapon-fire-preview/preview-definition';
import {
  createWeaponFirePreviewState,
  cloneWeaponFirePreviewState,
  type WeaponFirePreviewState,
  startWeaponFirePreview,
  stopWeaponFirePreview,
  advanceWeaponFirePreview,
  weaponGlowLevel,
} from '@/domain/weapon-fire-preview/simulation';
import { useWindowShortcuts } from '@/app/composables/use-window-shortcuts';
import { watchCanvasPixelRatio } from '@/app/composables/canvas/use-canvas-surface';
import { useCanvasViewport } from '@/app/composables/canvas/use-canvas-viewport';
import { useCanvasNavigation } from '@/app/composables/canvas/use-canvas-navigation';
import { weaponCanvasPoint, weaponPointFromCanvas } from '@/domain/editors/lib/geometry';
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
    viewport = useCanvasViewport(canvasRef, 1, 20);
  const state = shallowRef(createWeaponFirePreviewState()),
    viewMode = computed(() => state.value.mode);
  const history: { state: WeaponFirePreviewState; sources: WeaponFirePreviewDefinition[] }[] = [],
    position = ref(0);
  const definition = computed(() =>
    createWeaponFirePreviewDefinition(props.weaponCsvRow, props.weaponSpec, props.projectile ?? {}, viewMode.value, props.resources),
  );
  const sources = shallowRef<WeaponFirePreviewDefinition[]>([definition.value]);
  function stateSources(value: WeaponFirePreviewState) {
    return [
      ...new Set([
        ...value.projectiles.map((item) => item.definition),
        ...value.effects.map((item) => item.definition),
        ...(value.beam.definition ? [value.beam.definition] : []),
      ]),
    ];
  }
  function synchronize() {
    const next = [...new Set([definition.value, ...stateSources(state.value), ...history.flatMap((item) => item.sources)])];
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
  const navigation = useCanvasNavigation(viewport, redraw, 'pointer');
  let inside = false,
    fitScale = 1,
    last = 0,
    stopDpi: (() => void) | null = null;
  function redraw() {
    if (!state.value.running) draw();
  }
  function fitView() {
    fitScale = (viewport.size().width - 140) / Math.max(definition.value.range, 100);
    viewport.fit(1);
    viewport.pan.value.x = 80 - viewport.size().width / 2;
    draw();
  }
  function refreshView() {
    if (viewport.fitted.value) fitView();
    else draw();
  }
  function restart() {
    history.splice(position.value + 1);
    synchronize();
    frames.stop();
    last = 0;
    frames.start();
  }
  function reset() {
    state.value = createWeaponFirePreviewState(state.value.mode, state.value.speed);
    resetHistory();
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
      resetHistory();
      draw();
    }
  }
  function startFiring() {
    const paused = !state.value.running;
    startWeaponFirePreview(state.value);
    state.value = { ...state.value };
    resetHistory();
    if (paused) restart();
  }
  function stopFiring() {
    stopWeaponFirePreview(state.value);
    state.value = { ...state.value };
    resetHistory();
  }
  function record(replace = false) {
    if (replace) history.pop();
    history.push({ state: cloneWeaponFirePreviewState(state.value), sources: stateSources(state.value) });
    if (history.length > 120) history.shift();
    position.value = history.length - 1;
    synchronize();
  }
  function resetHistory() {
    history.length = 0;
    record();
  }
  function advance(dt: number) {
    advanceWeaponFirePreview(state.value, definition.value, dt, Math.random, engines.style);
    record(dt === 0);
  }
  function step(direction: -1 | 1) {
    frames.stop();
    const next = position.value + direction;
    if (next === history.length) {
      state.value = { ...state.value, running: true };
      advance(1 / 60);
    } else {
      position.value = next;
      state.value = { ...cloneWeaponFirePreviewState(history[next]!.state), speed: state.value.speed };
    }
    state.value = { ...state.value, running: false };
    synchronize();
    draw();
  }
  function frame(time: number) {
    if (!last) last = time;
    const dt = ((time - last) / 1000) * state.value.speed;
    last = time;
    advance(dt);
    draw();
  }
  function draw() {
    const c = canvasRef.value;
    if (!c) return;
    const origin = viewport.center(),
      scale = fitScale * viewport.scale.value,
      point = weaponPointFromCanvas(navigation.last, origin, scale),
      coord = { x: Math.round(point.x * 2) / 2, y: Math.round(point.y * 2) / 2 };
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
          base: {
            ...viewport.size(),
            center: origin,
            scale,
            palette: palette.value,
            mirrorY: null,
            cursor: inside
              ? { point: weaponCanvasPoint(coord, origin, scale), label: coord.x.toFixed(1) + ', ' + coord.y.toFixed(1) }
              : null,
          },
          definition: definition.value,
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
    viewport.resize(rect?.width, rect?.height);
    refreshView();
  }
  useWindowShortcuts({ keys: { u: () => setView('turret'), h: () => setView('hardpoint') } });
  onMounted(() => {
    stopDpi = watchCanvasPixelRatio(resize);
    resize();
    fitView();
    window.addEventListener('resize', resize);
    reset();
  });
  onUnmounted(() => {
    history.length = 0;
    navigation.finish();
    stopDpi?.();
    window.removeEventListener('resize', resize);
  });
  watch(
    () => [props.sessionId, props.weaponId],
    () => {
      state.value = createWeaponFirePreviewState(state.value.mode, state.value.speed);
      resetHistory();
      refreshView();
    },
  );
  watch(
    definition,
    () => {
      resetHistory();
      refreshView();
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
      canStepBack: computed(() => position.value > 0),
      fitted: viewport.fitted,
      hasWeaponSpec,
      mediaReady: images.ready,
      previewSubtitle: computed(() => '武器 ' + props.weaponId + ' · 弹体 ' + (str(props.weaponSpec.projectileSpecId) || '-')),
      speedLabel: computed(() => state.value.speed.toFixed(1) + 'x'),
    }),
    actions: {
      step,
      fitView,
      onDown: navigation.start,
      onUp: navigation.finish,
      onWheel: navigation.wheel,
      onMove: (event: MouseEvent) => {
        inside = true;
        if (!navigation.move(event)) redraw();
      },
      onLeave: () => {
        inside = false;
        navigation.finish();
        redraw();
      },
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
