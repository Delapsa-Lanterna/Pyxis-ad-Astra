import type { Point } from '@/domain/editors/editor-types';
import type { DeepReadonly, RowData } from '@/shared/types';
import { arr, num, str } from '@/shared/lib/starsector';
import { isRowData } from '@/shared/lib/row-data';
import { createFiringState, scheduleShots } from './firing';
import type { WeaponViewMode } from '@/shared/lib/starsector/weapon-sprite-fields';
import type { ProjectileAppearance } from '@/domain/editors/projectile-appearance';
import type { WeaponFirePreviewDefinition } from './preview-definition';

export interface TrailPoint extends Point {
  time: number;
}
export type WeaponFirePreviewProjectileState = ReturnType<typeof spawn>;
export function createWeaponFirePreviewState(mode: WeaponViewMode = 'turret', speed = 1) {
  return {
    running: true,
    firing: false,
    mode,
    speed,
    time: 0,
    firingState: createFiringState(),
    projectiles: [] as WeaponFirePreviewProjectileState[],
    effects: [] as PreviewExplosion[],
    beam: {
      alpha: 0,
      length: 0,
      offset: 0,
      phase: 'idle',
      timer: 0,
      fringeOffset: 0,
      definition: null as WeaponFirePreviewDefinition | null,
    },
  };
}
export type WeaponFirePreviewState = ReturnType<typeof createWeaponFirePreviewState>;
export function cloneWeaponFirePreviewState(state: WeaponFirePreviewState): WeaponFirePreviewState {
  return {
    ...state,
    firingState: { ...state.firingState },
    beam: { ...state.beam },
    projectiles: state.projectiles.map((projectile) => ({
      ...projectile,
      trails: projectile.trails.map((trail) => ({
        ...trail,
        color: [...trail.color],
        points: trail.points.map((point) => ({ ...point })),
      })),
    })),
    effects: state.effects.map((effect) => ({ ...effect, particles: effect.particles.map((particle) => ({ ...particle })) })),
  };
}
export type WeaponFirePreviewBeamState = WeaponFirePreviewState['beam'];
export interface PreviewExplosion extends Point {
  definition: WeaponFirePreviewDefinition;
  age: number;
  duration: number;
  radius: number;
  color: DeepReadonly<RowData>[string];
  particles: { x: number; y: number; size: number }[];
}
type EngineSlot = ProjectileAppearance['engines'][number];
export function startWeaponFirePreview(state: WeaponFirePreviewState) {
  state.firing = true;
  state.running = true;
}
export function stopWeaponFirePreview(state: WeaponFirePreviewState) {
  state.firing = false;
}
export function weaponGlowLevel(state: WeaponFirePreviewState, p: WeaponFirePreviewDefinition): number {
  if (p.beam) return state.beam.alpha;
  const { phase, remaining } = state.firingState;
  if (phase === 'idle') return 0;
  if (phase === 'burst') return 1;
  if (phase === 'chargeup') return p.chargeup ? 1 - remaining / p.chargeup : 1;
  if (remaining > p.chargeup) return p.chargedown ? (remaining - p.chargeup) / p.chargedown : 0;
  return state.firing || p.autoCharge ? (p.chargeup ? 1 - remaining / p.chargeup : 1) : 0;
}

function advanceBeam(beam: WeaponFirePreviewBeamState, p: WeaponFirePreviewDefinition, dt: number, firing: boolean, random: () => number) {
  if (beam.definition && beam.definition !== p) {
    const key =
      beam.phase === 'chargeup'
        ? 'chargeup'
        : beam.phase === 'burst'
          ? 'burstSize'
          : beam.phase === 'chargedown'
            ? 'chargedown'
            : 'burstDelay';
    const previous = beam.definition[key];
    beam.timer = previous ? (beam.timer / previous) * p[key] : p[key];
    beam.length = Math.min(beam.length, p.range);
  }
  beam.definition = p;
  if (beam.phase === 'idle' && firing && p.randomPhase) beam.offset = beam.fringeOffset = random();
  if (beam.phase === 'chargedown' && firing && !p.burstSize) {
    beam.phase = 'chargeup';
    beam.timer = p.chargeup * (1 - beam.alpha);
  }
  beam.offset -= (dt * p.appearance.scroll) / 128;
  beam.fringeOffset -= (dt * p.appearance.scroll * p.appearance.fringeScroll) / 128;
  if (!firing && beam.phase !== 'chargedown' && beam.phase !== 'idle') {
    beam.phase = 'chargedown';
    beam.timer = p.chargedown * beam.alpha;
  }
  let remaining = dt;
  while (remaining >= 0) {
    if (beam.phase === 'idle') {
      if (!firing) break;
      beam.phase = 'chargeup';
      beam.timer = p.chargeup;
      beam.length = 0;
    }
    if (beam.phase === 'burst' && !p.burstSize) {
      beam.alpha = 1;
      break;
    }
    const used = Math.min(remaining, beam.timer);
    beam.timer -= used;
    remaining -= used;
    if (beam.phase === 'chargeup') beam.alpha = p.chargeup ? 1 - beam.timer / p.chargeup : 1;
    if (beam.phase === 'chargedown') beam.alpha = p.chargedown ? beam.timer / p.chargedown : 0;
    if (beam.timer > 0) break;
    if (beam.phase === 'chargeup') {
      beam.phase = 'burst';
      beam.timer = p.burstSize;
      beam.alpha = 1;
    } else if (beam.phase === 'burst') {
      beam.phase = 'chargedown';
      beam.timer = p.chargedown;
    } else if (beam.phase === 'chargedown') {
      beam.alpha = 0;
      beam.phase = firing && p.burstSize > 0 ? 'cooldown' : 'idle';
      beam.timer = p.burstDelay;
      if (beam.phase === 'idle' || (!p.skipIdle && !p.burstDelay)) break;
    } else {
      beam.phase = 'idle';
    }
    if (!remaining) break;
  }
  beam.length = p.speed > 0 ? Math.min(p.range, beam.length + p.speed * dt) : p.range;
}
function spawn(definition: WeaponFirePreviewDefinition, barrel: number, angle: number, style: (slot: EngineSlot) => DeepReadonly<RowData>) {
  const point = definition.barrels[barrel]!;
  return {
    x: point.x,
    y: point.y,
    angle: (angle * Math.PI) / 180,
    speed: definition.appearance.kind === 'missile' ? definition.launchSpeed : definition.speed,
    definition,
    age: 0,
    distance: 0,
    alpha: 1,
    trails: definition.appearance.engines.map((slot, index) => {
      const value = style(slot),
        strip = value.mode === 'QUAD_STRIP';
      return {
        points: [] as TrailPoint[],
        style: value,
        color: arr(value.contrailColor, [255, 255, 255, 255]),
        width: slot.width * num(value[strip ? 'contrailWidthMult' : 'contrailParticleSizeMult'], 1),
        duration: num(value[strip ? 'contrailDuration' : 'contrailParticleDuration']),
        slot: index,
        nextSample: 0,
      };
    }),
  };
}
function explode(state: WeaponFirePreviewState, projectile: WeaponFirePreviewProjectileState, random: () => number) {
  const value = projectile.definition.behavior.explosionSpec;
  if (!isRowData(value)) return false;
  state.effects.push({
    definition: projectile.definition,
    x: projectile.x,
    y: projectile.y,
    age: 0,
    duration: Math.max(num(value.duration), num(value.particleDuration)),
    radius: num(value.radius),
    color: value.particleColor ?? [255, 255, 255, 255],
    particles: Array.from({ length: num(value.particleCount) }, () => {
      const angle = random() * Math.PI * 2,
        speed = random();
      return {
        x: Math.cos(angle) * speed,
        y: Math.sin(angle) * speed,
        size: num(value.particleSizeMin) + random() * num(value.particleSizeRange),
      };
    }),
  });
  return true;
}
function advanceProjectile(o: WeaponFirePreviewProjectileState, dt: number) {
  const p = o.definition,
    missile = p.appearance.kind === 'missile',
    before = o.age;
  o.age += dt;
  if (missile && before < p.flightTime) {
    const powered = !['NO_AI', 'BOMB', 'PHASE_MINE', 'MOTE'].includes(p.missileType);
    const acceleration = p.missileType === 'BOMB_WITH_SLOW' ? -p.deceleration : powered ? p.acceleration : 0;
    const duration = Math.min(dt, p.flightTime - before),
      initial = o.speed;
    o.speed = Math.max(0, Math.min(p.speed, initial + acceleration * duration));
    const accelerating = acceleration ? (o.speed - initial) / acceleration : 0;
    const distance = initial * accelerating + 0.5 * acceleration * accelerating * accelerating + o.speed * (dt - accelerating);
    o.x += Math.cos(o.angle) * distance;
    o.y += Math.sin(o.angle) * distance;
    o.distance += distance;
  } else {
    const distance = o.speed * dt;
    o.x += Math.cos(o.angle) * distance;
    o.y += Math.sin(o.angle) * distance;
    o.distance += distance;
  }
  if (missile && p.rangeFlameout && o.distance > p.range && o.age < p.flightTime) o.age = p.flightTime;
  const fadeStart = p.flightTime + (missile ? Math.max(0, p.flameoutTime - p.fadeTime) : 0);
  o.alpha = o.age <= fadeStart ? 1 : p.fadeTime ? Math.max(0, 1 - (o.age - fadeStart) / p.fadeTime) : 0;
  for (const trail of o.trails) {
    const slot = p.appearance.engines[trail.slot]!,
      cos = Math.cos(o.angle),
      sin = Math.sin(o.angle);
    const point = { x: o.x + slot.point.x * cos + slot.point.y * sin, y: o.y + slot.point.x * sin - slot.point.y * cos, time: o.age };
    if (trail.duration > 0 && o.age < p.flightTime)
      while (trail.nextSample <= o.distance) {
        const back = o.distance - trail.nextSample;
        trail.points.push({ x: point.x - cos * back, y: point.y - sin * back, time: back ? o.age - back / o.speed : o.age });
        trail.nextSample += Math.max(1, trail.style.mode === 'QUAD_STRIP' ? num(trail.style.contrailMinSeg, 5) : trail.width * 0.35);
      }
    let expired = 0;
    while (expired < trail.points.length && o.age - trail.points[expired]!.time > trail.duration) expired++;
    if (expired) trail.points.splice(0, expired);
  }
}
function advanceShot(state: WeaponFirePreviewState, o: WeaponFirePreviewProjectileState, dt: number, random: () => number) {
  const p = o.definition,
    end = p.flightTime + (p.appearance.kind === 'missile' ? Math.max(0, p.flameoutTime - p.fadeTime) : 0);
  if (str(p.behavior.behavior) === 'PROXIMITY_FUSE' && isRowData(p.behavior.explosionSpec) && o.age + dt >= end) {
    const remaining = Math.max(0, end - o.age);
    advanceProjectile(o, remaining);
    explode(state, o, random);
    state.effects[state.effects.length - 1]!.age = dt - remaining;
    return false;
  }
  advanceProjectile(o, dt);
  return o.alpha > 0 || o.trails.some((trail) => trail.points.length);
}
export function advanceWeaponFirePreview(
  state: WeaponFirePreviewState,
  definition: WeaponFirePreviewDefinition,
  dt: number,
  random: () => number = Math.random,
  style: (slot: EngineSlot) => DeepReadonly<RowData> = (slot) => (isRowData(slot.styleSpec) ? slot.styleSpec : {}),
) {
  if (!state.running) return;
  state.time += dt;
  for (const effect of state.effects) effect.age += dt;
  state.effects = state.effects.filter((effect) => effect.age < effect.duration);
  let retained = 0;
  for (const o of state.projectiles) {
    if (advanceShot(state, o, dt, random)) state.projectiles[retained++] = o;
  }
  state.projectiles.length = retained;
  if (definition.beam) advanceBeam(state.beam, definition, dt, state.firing, random);
  else {
    state.beam.alpha = 0;
    for (const event of scheduleShots(state.firingState, definition, dt, state.firing, random)) {
      const o = spawn(definition, event.barrel, event.angle, style);
      if (advanceShot(state, o, dt - event.time, random)) state.projectiles.push(o);
    }
  }
}
