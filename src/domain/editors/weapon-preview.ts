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
