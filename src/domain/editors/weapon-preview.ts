import { weaponCanvasPoint } from './lib/geometry';
import type { Point } from './editor-types';
import type { RowData } from '@/shared/types';
import { num, str } from '@/shared/lib/starsector';
import { weaponBarrelOffsetsFor, weaponAnglesKey, type WeaponViewMode } from './lib/weapon-sprite-fields';
export function createWeaponPreviewParams(csv: RowData, wpn: RowData, proj: RowData, mode: WeaponViewMode) {
  return {
    specClass: str(wpn.specClass, 'projectile'),
    range: num(csv.range, 600),
    projSpeed: num(csv['proj speed'], 800),
    beamSpeed: num(csv['beam speed'], 0),
    hasBurstSize: str(csv['burst size']) !== '',
    hasBurstDelay: str(csv['burst delay']) !== '',
    burstSize: Math.max(1, num(csv['burst size'], 1)),
    burstDelay: num(csv['burst delay'], 0),
    chargeup: num(csv.chargeup, 0),
    chargedown: num(csv.chargedown, 0.5),
    minSpread: num(csv['min spread'], 0),
    maxSpread: num(csv['max spread'], 0),
    barrelMode: str(wpn.barrelMode, 'ALTERNATING'),
    offsets: weaponBarrelOffsetsFor(wpn, mode),
    angles: Array.isArray(wpn[weaponAnglesKey(mode)]) ? (wpn[weaponAnglesKey(mode)] as number[]) : [],
    beamWidth: num(wpn.width, 10),
    fringeColor: wpn.fringeColor || [255, 100, 100, 255],
    coreColor: wpn.coreColor || [255, 255, 255, 255],
    textureScrollSpeed: num(wpn.textureScrollSpeed, 200),
    projLength: num(proj.length, 20),
    projWidth: num(proj.width, 4),
    projFringeColor: proj.fringeColor || [255, 100, 50, 200],
    projCoreColor: proj.coreColor || [255, 255, 200, 255],
    spawnType: str(proj.spawnType, 'BALLISTIC'),
    missileType: str(proj.specClass) === 'missile' ? str(proj.missileType, 'MISSILE') : '',
    missileAcc: num((proj.engineSpec as RowData)?.acc, 200),
    missileMaxSpeed: num((proj.engineSpec as RowData)?.maxSpeed, num(csv['proj speed'], 800)),
    missileSize: Array.isArray(proj.size) ? (proj.size as number[]) : [10, 10],
    explosionRadius: num(proj.explosionRadius, 50),
    explosionColor: proj.explosionColor || [255, 200, 50, 255],
  };
}
export type WeaponPreviewParams = ReturnType<typeof createWeaponPreviewParams>;
export interface TrailPoint {
  x: number;
  y: number;
}
export interface ProjectilePreviewState {
  x: number;
  y: number;
  angle: number;
  speed: number;
  age: number;
  trail: TrailPoint[];
  exploding: boolean;
  explosionAge: number;
  missile: boolean;
}
export interface BeamPreviewState {
  alpha: number;
  phase: 'idle' | 'chargeup' | 'burst' | 'chargedown' | 'cooldown';
  length: number;
  offset: number;
  timer: number;
}
export interface BarrelState {
  x: number;
  y: number;
  angle: number;
}

export function advancePreviewProjectiles(
  source: readonly ProjectilePreviewState[],
  p: WeaponPreviewParams,
  dt: number,
  s: number,
  originX: number,
  range: number,
): ProjectilePreviewState[] {
  const max = p.missileMaxSpeed * s;
  const acc = p.missileAcc * s;
  const projectiles = source.map((item) => ({ ...item, trail: [...item.trail] }));
  for (const obj of projectiles) {
    if (obj.missile) obj.speed = Math.min(max, obj.speed + acc * dt);
    obj.x += Math.cos(obj.angle) * obj.speed * dt;
    obj.y -= Math.sin(obj.angle) * obj.speed * dt;
    obj.age += dt;
    if (obj.missile) {
      obj.trail.push({ x: obj.x, y: obj.y });
      if (obj.trail.length > 30) obj.trail.shift();
      if (obj.x - originX > range) obj.exploding = true;
      if (obj.exploding) obj.explosionAge += dt;
    }
  }
  return projectiles.filter((o) => o.age < 8 && (!o.exploding || o.explosionAge < 0.5));
}

export function beginPreviewBeamCharge(source: BeamPreviewState, p: WeaponPreviewParams): BeamPreviewState {
  const beam = { ...source };
  beam.phase = 'chargeup';
  beam.timer = Math.max(p.chargeup, 0.01) * (1 - beam.alpha);
  beam.length = 0;
  return beam;
}
function advancePreviewBeamLength(beam: BeamPreviewState, p: WeaponPreviewParams, dt: number) {
  beam.length = p.beamSpeed > 0 ? Math.min(p.range, beam.length + p.beamSpeed * dt) : p.range;
}
export function advancePreviewBeam(source: BeamPreviewState, p: WeaponPreviewParams, dt: number, firing: boolean): BeamPreviewState {
  let beam = { ...source };
  const isBurst = p.specClass === 'beam' && p.hasBurstSize && p.hasBurstDelay && p.burstDelay > 0;
  beam.offset += p.textureScrollSpeed * dt;
  if (!firing && beam.phase !== 'chargedown') {
    if (beam.alpha > 0) {
      beam.phase = 'chargedown';
      beam.timer = Math.max(p.chargedown, 0.01) * beam.alpha;
    } else {
      beam.phase = 'idle';
      return beam;
    }
  }
  if (firing && beam.phase === 'idle') beam = beginPreviewBeamCharge(beam, p);
  if (beam.phase === 'chargeup') {
    const duration = Math.max(p.chargeup, 0.01);
    beam.timer = Math.max(0, beam.timer - dt);
    beam.alpha = Math.min(1, 1 - beam.timer / duration);
    advancePreviewBeamLength(beam, p, dt);
    if (beam.timer <= 0) {
      beam.alpha = 1;
      beam.phase = 'burst';
      beam.timer = isBurst ? p.burstSize : 0;
    }
    return beam;
  }
  if (beam.phase === 'burst') {
    beam.alpha = 1;
    advancePreviewBeamLength(beam, p, dt);
    if (isBurst) {
      beam.timer = Math.max(0, beam.timer - dt);
      if (beam.timer <= 0) {
        beam.phase = 'chargedown';
        beam.timer = Math.max(p.chargedown, 0.01);
      }
    }
    return beam;
  }
  if (beam.phase === 'chargedown') {
    const duration = Math.max(p.chargedown, 0.01);
    beam.timer = Math.max(0, beam.timer - dt);
    beam.alpha = Math.max(0, beam.timer / duration);
    if (beam.timer <= 0) {
      beam.alpha = 0;
      beam.phase = firing && isBurst ? 'cooldown' : 'idle';
      beam.timer = firing && isBurst ? p.burstDelay : 0;
    }
    return beam;
  }
  if (beam.phase === 'cooldown') {
    beam.timer = Math.max(0, beam.timer - dt);
    if (beam.timer <= 0 && firing) beam = beginPreviewBeamCharge(beam, p);
  }
  return beam;
}

export interface WeaponPreviewState {
  running: boolean;
  firing: boolean;
  speed: number;
  mode: WeaponViewMode;
  fireTimer: number;
  burst: number;
  barrelIndex: number;
  projectiles: ProjectilePreviewState[];
  beam: BeamPreviewState;
}
export function createWeaponPreviewState(p: WeaponPreviewParams, mode: WeaponViewMode = 'turret', speed = 1): WeaponPreviewState {
  return {
    running: true,
    firing: false,
    speed,
    mode,
    fireTimer: p.chargeup,
    burst: 0,
    barrelIndex: 0,
    projectiles: [],
    beam: { alpha: 0, length: 0, offset: 0, phase: 'idle', timer: 0 },
  };
}
export function previewBarrels(p: WeaponPreviewParams, origin: Point, scale: number): BarrelState[] {
  return Array.from({ length: Math.max(1, Math.floor(p.offsets.length / 2)) }, (_, i) => ({
    ...weaponCanvasPoint({ x: p.offsets[i * 2] || 0, y: p.offsets[i * 2 + 1] || 0 }, origin, scale),
    angle: p.angles[i] || 0,
  }));
}
export function startWeaponPreview(state: WeaponPreviewState, p: WeaponPreviewParams): WeaponPreviewState {
  return {
    ...state,
    running: true,
    firing: true,
    fireTimer: 0,
    beam: p.specClass === 'beam' ? beginPreviewBeamCharge(state.beam, p) : state.beam,
  };
}
export function stopWeaponPreview(state: WeaponPreviewState, p: WeaponPreviewParams): WeaponPreviewState {
  const beam =
    p.specClass === 'beam' && state.beam.alpha > 0
      ? { ...state.beam, phase: 'chargedown' as const, timer: Math.max(p.chargedown, 0.01) * state.beam.alpha }
      : state.beam;
  return { ...state, firing: false, beam };
}
export function advanceWeaponPreview(
  source: WeaponPreviewState,
  p: WeaponPreviewParams,
  dt: number,
  origin: Point,
  scale: number,
  random: () => number,
): WeaponPreviewState {
  if (!source.running) return source;
  const state = { ...source };
  if (p.specClass === 'beam') return { ...state, beam: advancePreviewBeam(state.beam, p, dt, state.firing) };
  const spawned: ProjectilePreviewState[] = [];
  if (state.firing) {
    state.fireTimer -= dt;
    if (state.fireTimer <= 0) {
      const barrels = previewBarrels(p, origin, scale);
      const indices = p.barrelMode === 'LINKED' ? barrels.map((_, i) => i) : [state.barrelIndex];
      for (const i of indices) {
        const barrel = barrels[i];
        if (!barrel) continue;
        const spread = ((p.minSpread + random() * (p.maxSpread - p.minSpread)) * Math.PI) / 180;
        spawned.push({
          x: barrel.x,
          y: barrel.y,
          angle: (barrel.angle * Math.PI) / 180 + (random() - 0.5) * spread,
          speed: p.projSpeed * scale * (p.missileType ? 0.3 : 1),
          age: 0,
          trail: [],
          exploding: false,
          explosionAge: 0,
          missile: Boolean(p.missileType),
        });
      }
      if (p.barrelMode !== 'LINKED') state.barrelIndex = (state.barrelIndex + 1) % barrels.length;
      state.burst++;
      if (state.burst >= p.burstSize) {
        state.fireTimer = p.chargedown + p.chargeup;
        state.burst = 0;
      } else state.fireTimer = p.burstDelay;
    }
  }
  return { ...state, projectiles: advancePreviewProjectiles([...state.projectiles, ...spawned], p, dt, scale, origin.x, p.range * scale) };
}
