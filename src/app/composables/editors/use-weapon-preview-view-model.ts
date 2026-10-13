import {
  beginPreviewBeamCharge,
  advancePreviewBeam,
  advancePreviewProjectiles,
  createWeaponPreviewParams,
  type ProjectilePreviewState,
  type BeamPreviewState,
  type BarrelState,
} from '@/domain/editors/weapon-preview';

import { computed, onMounted, onUnmounted, ref, watch, type ShallowRef } from 'vue';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { useCanvasSurface, watchCanvasPixelRatio } from '@/app/composables/canvas/use-canvas-surface';
import type { RowData } from '@/shared/types';
import { str, arr } from '@/shared/lib/starsector';
import type { WeaponViewMode } from '@/domain/editors/lib/weapon-sprite-fields';

import { renderWeaponPreviewScene } from '@/app/renderers/editors/weapon-preview-scene';
import { useEditorFrameLoop } from '@/app/composables/editors/use-editor-frame-loop';
import { useEditorImages } from '@/app/composables/editors/use-editor-images';
import { useCanvasPalette } from '@/app/composables/canvas/use-canvas-palette';

export interface WeaponFirePreviewProps {
  weaponId: string;
  weaponCsvRow: RowData;
  weaponSpec: RowData;
  projectileSpecs: Record<string, RowData>;
  spriteData?: Record<string, string>;
}
export type WeaponFirePreviewEvents = { close: [] };

export function useWeaponPreviewViewModel(
  props: Readonly<WeaponFirePreviewProps>,
  elements: { canvasRef: Readonly<ShallowRef<HTMLCanvasElement | null>>; previewStageRef: Readonly<ShallowRef<HTMLElement | null>> },
) {
  const { canvasRef, previewStageRef } = elements;

  const surface = useCanvasSurface(canvasRef);
  const palette = useCanvasPalette(draw);
  let stopPixelRatio: (() => void) | null = null;
  const running = ref(true);
  const firing = ref(false);
  const speed = ref(1);
  const viewMode = ref<WeaponViewMode>('turret');
  let last = 0;
  let fireTimer = 0;
  let burst = 0;
  let barrelIndex = 0;

  let projectiles: ProjectilePreviewState[] = [];
  let beam: BeamPreviewState = { alpha: 0, length: 0, offset: 0, phase: 'idle', timer: 0 };
  const csv = computed(() => props.weaponCsvRow || {});
  const wpn = computed(() => props.weaponSpec || {});
  const proj = computed(() => props.projectileSpecs[str(wpn.value.projectileSpecId)] || {});
  const hasWeaponSpec = computed(() => Object.keys(props.weaponSpec).length > 0);
  const projectileId = computed(() => str(wpn.value.projectileSpecId) || '-');
  const previewSubtitle = computed(() => `武器 ${props.weaponId} · 弹体 ${projectileId.value}`);
  const speedLabel = computed(() => `${speed.value.toFixed(1)}x`);
  const params = computed(() => createWeaponPreviewParams(csv.value, wpn.value, proj.value, viewMode.value));
  function setSpeed(value: number) {
    speed.value = value;
  }
  const barrelCount = computed(() => Math.max(1, Math.floor(params.value.offsets.length / 2)));
  function setView(mode: WeaponViewMode) {
    if (!hasWeaponSpec.value) return;
    viewMode.value = mode;
    barrelIndex = 0;
    draw();
  }
  function scalePx() {
    const c = canvasRef.value;
    return c ? (surface.size().width - 140) / Math.max(params.value.range, 100) : 0.5;
  }
  function rangePx() {
    return params.value.range * scalePx();
  }
  function reset() {
    projectiles = [];
    resetBeam();
    fireTimer = params.value.chargeup;
    burst = 0;
    barrelIndex = 0;
    last = 0;
    firing.value = false;
    running.value = true;
    restartAnimation();
  }
  function toggle() {
    running.value = !running.value;
    if (running.value) restartAnimation();
    else frames.stop();
  }
  function restartAnimation() {
    frames.stop();
    last = 0;
    frames.start();
  }
  function startFiring() {
    firing.value = true;
    fireTimer = 0;
    if (params.value.specClass === 'beam') beginBeamCharge();
    if (!running.value) toggle();
  }
  function stopFiring() {
    firing.value = false;
    if (params.value.specClass === 'beam' && beam.alpha > 0) {
      beam.phase = 'chargedown';
      beam.timer = Math.max(params.value.chargedown, 0.01) * beam.alpha;
    }
  }
  function resetBeam() {
    beam = { alpha: 0, length: 0, offset: 0, phase: 'idle', timer: 0 };
  }
  function beginBeamCharge() {
    beam = beginPreviewBeamCharge(beam, params.value);
  }
  function weaponOrigin() {
    const c = canvasRef.value;
    return { x: 80, y: c ? surface.size().height / 2 : 0 };
  }
  function barrelAt(index: number): BarrelState | null {
    if (index < 0 || index >= barrelCount.value) return null;
    const p = params.value;
    const origin = weaponOrigin();
    const s = scalePx();
    const bx = p.offsets[index * 2] || 0;
    const by = p.offsets[index * 2 + 1] || 0;
    return {
      x: origin.x + bx * s,
      y: origin.y - by * s,
      angle: p.angles[index] || 0,
    };
  }
  function fireProjectile(missile = false) {
    const p = params.value;
    const s = scalePx();
    const create = (i: number) => {
      const barrel = barrelAt(i);
      if (!barrel) return;
      const spread = ((p.minSpread + Math.random() * (p.maxSpread - p.minSpread)) * Math.PI) / 180;
      const ang = (barrel.angle * Math.PI) / 180 + (Math.random() - 0.5) * spread;
      projectiles.push({
        x: barrel.x,
        y: barrel.y,
        angle: ang,
        speed: missile ? p.projSpeed * s * 0.3 : p.projSpeed * s,
        age: 0,
        trail: [],
        exploding: false,
        explosionAge: 0,
        missile,
      });
    };
    if (p.barrelMode === 'LINKED') for (let i = 0; i < barrelCount.value; i++) create(i);
    else {
      create(barrelIndex);
      barrelIndex = (barrelIndex + 1) % barrelCount.value;
    }
  }
  function update(dt: number) {
    const p = params.value;
    if (p.specClass === 'beam') {
      updateBeam(dt);
      return;
    }
    if (!firing.value) {
      updateProjectiles(dt);
      return;
    }
    fireTimer -= dt;
    if (fireTimer <= 0) {
      fireProjectile(Boolean(p.missileType));
      burst++;
      if (burst >= p.burstSize) {
        fireTimer = p.chargedown + p.chargeup;
        burst = 0;
      } else fireTimer = p.burstDelay;
    }
    updateProjectiles(dt);
  }
  function updateBeam(dt: number) {
    beam = advancePreviewBeam(beam, params.value, dt, firing.value);
  }
  function updateProjectiles(dt: number) {
    projectiles = advancePreviewProjectiles(projectiles, params.value, dt, scalePx(), weaponOrigin().x, rangePx());
  }
  function draw() {
    const c = canvasRef.value;
    if (!c) return;
    const color = arr(wpn.value.glowColor, [255, 255, 255, 255]);
    const glow = images.images.get(viewMode.value === 'turret' ? 'turretGlowSprite' : 'hardpointGlowSprite');
    renderWeaponPreviewScene(c.getContext('2d')!, {
      size: surface.size(),
      palette: palette.value,
      params: params.value,
      origin: weaponOrigin(),
      range: rangePx(),
      scale: scalePx(),
      hasWeaponSpec: hasWeaponSpec.value,
      assets: {
        images: images.images,
        weapon: wpn.value,
        mode: viewMode.value,
        scale: scalePx(),
        center: weaponOrigin(),
        glowTint: glow ? images.tintImage(glow, color) : null,
        glowColor: color,
      },
      barrels: Array.from({ length: barrelCount.value }, (_, i) => barrelAt(i)).filter((barrel): barrel is BarrelState => barrel !== null),
      projectiles,
      beam,
    });
  }
  function frame(ts: number) {
    if (!last) last = ts;
    const dt = Math.min(((ts - last) / 1000) * speed.value, 0.1);
    last = ts;
    update(dt);
    draw();
  }
  function resize() {
    const c = canvasRef.value;
    if (!c) return;
    const rect = previewStageRef.value?.getBoundingClientRect();
    surface.resize(rect?.width, rect?.height);
    draw();
  }
  useShortcutDispatch({
    keys: {
      u: () => setView('turret'),
      h: () => setView('hardpoint'),
    },
  });
  onMounted(() => {
    stopPixelRatio = watchCanvasPixelRatio(resize);
    resize();
    window.addEventListener('resize', resize);
    reset();
  });
  onUnmounted(() => {
    stopPixelRatio?.();
    window.removeEventListener('resize', resize);
  });
  watch(() => [params.value, wpn.value.glowColor, wpn.value.renderHints], draw, { flush: 'post' });
  const frames = useEditorFrameLoop(frame);
  const images = useEditorImages(() => props.spriteData ?? {}, draw);

  return {
    running,
    firing,
    speed,
    viewMode,
    hasWeaponSpec,
    previewSubtitle,
    speedLabel,
    setSpeed,
    setView,
    reset,
    toggle,
    startFiring,
    stopFiring,
  };
}
