import { describe, expect, it } from 'vitest';
import {
  createWeaponFirePreviewParams,
  createWeaponFirePreviewState,
  startWeaponFirePreview,
  stopWeaponFirePreview,
  advanceWeaponFirePreview,
  beginWeaponFirePreviewBeamCharge,
  advanceWeaponFirePreviewBeam,
  advanceWeaponFirePreviewProjectiles,
  type WeaponFirePreviewBeamState,
  type WeaponFirePreviewProjectileState,
} from './simulation';

describe('weapon preview progression', () => {
  it('advances charge and discharge without mutating the previous beam state', () => {
    const params = createWeaponFirePreviewParams({ chargeup: 1, chargedown: 0.5 }, { specClass: 'beam' }, {}, 'turret');
    const idle: WeaponFirePreviewBeamState = { alpha: 0, phase: 'idle', length: 0, offset: 0, timer: 0 };
    const charged = advanceWeaponFirePreviewBeam(beginWeaponFirePreviewBeamCharge(idle, params), params, 1, true);
    expect(charged.phase).toBe('burst');
    expect(charged.alpha).toBe(1);
    const fading = advanceWeaponFirePreviewBeam(charged, params, 0.25, false);
    expect(fading.phase).toBe('chargedown');
    expect(fading.alpha).toBe(0.5);
    expect(advanceWeaponFirePreviewBeam(fading, params, 0.25, false).phase).toBe('idle');
    expect(idle.phase).toBe('idle');
    expect(charged.alpha).toBe(1);
  });

  it('advances missile movement and expires its explosion while preserving the earlier frame', () => {
    const params = createWeaponFirePreviewParams(
      { range: 5 },
      {},
      { specClass: 'missile', engineSpec: { acc: 10, maxSpeed: 100 } },
      'turret',
    );
    const source: WeaponFirePreviewProjectileState = {
      x: 0,
      y: 0,
      angle: 0,
      speed: 10,
      age: 0,
      trail: [],
      exploding: false,
      explosionAge: 0,
      missile: true,
    };
    const next = advanceWeaponFirePreviewProjectiles([source], params, 0.25, 1, 0, 1);
    expect(next[0]!.x).toBe(3.125);
    expect(next[0]!.exploding).toBe(true);
    expect(next[0]!.trail).toHaveLength(1);
    expect(advanceWeaponFirePreviewProjectiles(next, params, 0.25, 1, 0, 1)).toEqual([]);
    expect(source.x).toBe(0);
    expect(source.trail).toEqual([]);
  });
});

describe('weapon preview simulation ownership', () => {
  it('alternates barrels, captures deterministic spread and freezes a paused simulation', () => {
    const p = createWeaponFirePreviewParams(
      { 'proj speed': 20, chargedown: 1 },
      { specClass: 'projectile', barrelMode: 'ALTERNATING', turretOffsets: [0, 10, 0, -10] },
      {},
      'turret',
    );
    const origin = { x: 80, y: 100 };
    let state = startWeaponFirePreview(createWeaponFirePreviewState(p), p);
    state = advanceWeaponFirePreview(state, p, 0.1, origin, 1, () => 0.5);
    expect(state.projectiles.map((x) => [x.x, x.y, x.angle])).toEqual([[82, 90, 0]]);
    expect(state.barrelIndex).toBe(1);
    const paused = { ...state, running: false },
      copy = JSON.stringify(paused);
    expect(advanceWeaponFirePreview(paused, p, 1, origin, 2, () => 0.5)).toBe(paused);
    expect(JSON.stringify(paused)).toBe(copy);
    state = advanceWeaponFirePreview(state, p, 1, origin, 1, () => 0.5);
    expect(state.projectiles).toHaveLength(2);
    expect(state.projectiles[1]!.y).toBe(110);
    expect(state.barrelIndex).toBe(0);
  });
  it('fires linked barrels together and maintains the configured burst delay', () => {
    const p = createWeaponFirePreviewParams(
      { 'proj speed': 20, 'burst size': 2, 'burst delay': 0.25, chargeup: 0.5, chargedown: 1 },
      { specClass: 'projectile', barrelMode: 'LINKED', turretOffsets: [0, 8, 0, -8] },
      {},
      'turret',
    );
    let state = startWeaponFirePreview(createWeaponFirePreviewState(p), p);
    state = advanceWeaponFirePreview(state, p, 0.1, { x: 80, y: 100 }, 1, () => 0.5);
    expect(state.projectiles).toHaveLength(2);
    expect(state.fireTimer).toBe(0.25);
    state = advanceWeaponFirePreview(state, p, 0.25, { x: 80, y: 100 }, 1, () => 0.5);
    expect(state.projectiles).toHaveLength(4);
    expect(state.burst).toBe(0);
    expect(state.fireTimer).toBe(1.5);
  });
  it('preserves ongoing particles after ceasefire and restarts a paused beam through its charge phase', () => {
    const p = createWeaponFirePreviewParams({ chargeup: 1, chargedown: 0.5 }, { specClass: 'beam' }, {}, 'turret');
    let state = startWeaponFirePreview({ ...createWeaponFirePreviewState(p), running: false }, p);
    expect(state.running).toBe(true);
    state = advanceWeaponFirePreview(state, p, 1, { x: 80, y: 100 }, 1, () => 0.5);
    expect(state.beam.phase).toBe('burst');
    expect(state.beam.alpha).toBe(1);
    state = stopWeaponFirePreview(state, p);
    state = advanceWeaponFirePreview(state, p, 0.25, { x: 80, y: 100 }, 1, () => 0.5);
    expect(state.beam.alpha).toBe(0.5);
    state = advanceWeaponFirePreview(state, p, 0.25, { x: 80, y: 100 }, 1, () => 0.5);
    expect(state.beam.phase).toBe('idle');
  });
});
