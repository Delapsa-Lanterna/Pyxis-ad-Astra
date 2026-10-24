import { describe, expect, it } from 'vitest';
import { createWeaponFirePreviewDefinition } from './preview-definition';
import {
  createWeaponFirePreviewState,
  cloneWeaponFirePreviewState,
  startWeaponFirePreview,
  stopWeaponFirePreview,
  advanceWeaponFirePreview,
  weaponGlowLevel,
} from './simulation';
import { createFiringState, scheduleShots } from './firing';
const random = () => 0.5;
const definition = () =>
  createWeaponFirePreviewDefinition(
    { range: 1000, 'proj speed': 20, chargeup: 0.5, chargedown: 1, 'burst size': 2, 'burst delay': 0.25 },
    { specClass: 'projectile', turretOffsets: [0, 10, 0, -10] },
    { fadeTime: 0.5 },
    'turret',
  );

describe('preview definition and simulation', () => {
  it.each(['projectile', 'missile', 'beam'])('clones %s state independently while sharing born definitions and styles', (kind) => {
    const p = createWeaponFirePreviewDefinition(
        { range: 2, 'proj speed': 10, 'launch speed': 10, 'flight time': 0.2, 'beam speed': 100, chargedown: 10 },
        { specClass: kind === 'beam' ? 'beam' : 'projectile' },
        {
          specClass: kind,
          fadeTime: 0.1,
          flameoutTime: 0,
          engineSlots: [{ loc: [0, 0], width: 2, styleSpec: { contrailDuration: 1, mode: 'QUAD_STRIP' } }],
          behaviorSpec: {
            behavior: 'PROXIMITY_FUSE',
            explosionSpec: { duration: 0.5, radius: 20, particleCount: 2, particleDuration: 0.5 },
          },
        },
        'turret',
      ),
      state = createWeaponFirePreviewState();
    startWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 0.1, random);
    const snapshot = cloneWeaponFirePreviewState(state),
      serialized = JSON.stringify(snapshot);
    expect(snapshot).toEqual(state);
    expect(snapshot.firingState).not.toBe(state.firingState);
    expect(snapshot.beam).not.toBe(state.beam);
    if (kind !== 'beam') expect(snapshot.projectiles[0]!.definition).toBe(p);
    if (kind === 'missile') {
      expect(snapshot.projectiles[0]!.trails[0]!.style).toBe(state.projectiles[0]!.trails[0]!.style);
      expect(snapshot.projectiles[0]!.trails[0]!.points).not.toBe(state.projectiles[0]!.trails[0]!.points);
      expect(snapshot.projectiles[0]!.trails[0]!.points.length).toBeGreaterThan(0);
    }
    stopWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 0.15, random);
    expect(JSON.stringify(snapshot)).toBe(serialized);
    if (kind !== 'beam') {
      expect(state.projectiles).toHaveLength(0);
      expect(state.effects).toHaveLength(1);
      const effect = cloneWeaponFirePreviewState(state);
      expect(effect.effects[0]!.definition).toBe(p);
      effect.effects[0]!.particles[0]!.x++;
      expect(effect.effects[0]!.particles).not.toEqual(state.effects[0]!.particles);
    }
    const restored = cloneWeaponFirePreviewState(snapshot);
    advanceWeaponFirePreview(restored, p, 0.4, random);
    expect(JSON.stringify(snapshot)).toBe(serialized);
  });
  it('uses CSV missile launch speed, maximum speed and flight time', () => {
    const p = createWeaponFirePreviewDefinition(
      { 'launch speed': 10, 'proj speed': 100, 'flight time': 2 },
      {},
      { specClass: 'missile', engineSpec: { acc: 10, maxSpeed: 999 }, maxFlightTime: 99 },
      'turret',
    );
    expect([p.launchSpeed, p.speed, p.flightTime]).toEqual([10, 100, 2]);
    expect(createWeaponFirePreviewDefinition({ 'burst size': 0.3 }, { specClass: 'beam' }, {}, 'turret').burstSize).toBe(0.3);
    expect(createWeaponFirePreviewDefinition({}, {}, {}, 'hardpoint').appearance.fringe).toEqual([255, 255, 255, 255]);
  });
  it('charges the first shot and accounts for multiple events within one frame', () => {
    const p = definition(),
      state = createWeaponFirePreviewState();
    startWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 0.49, random);
    expect(state.projectiles).toHaveLength(0);
    advanceWeaponFirePreview(state, p, 0.51, random);
    expect(state.projectiles.map((o) => [o.y, o.age])).toEqual([
      [10, 0.5],
      [-10, 0.25],
    ]);
    expect(state.projectiles[0]!.x).toBe(10);
    expect(state.projectiles[1]!.x).toBe(5);
  });
  it.each(['LINKED', 'DUAL', 'ALTERNATING', 'ALTERNATING_BURST'])('schedules %s barrels in order', (mode) => {
    const p = definition();
    p.barrelMode = mode;
    p.chargeup = 0;
    const state = createFiringState(),
      events = scheduleShots(state, p, 0.3, true, random);
    expect(events.map((e) => e.barrel)).toEqual(
      mode === 'LINKED' || mode === 'DUAL' ? [0, 1, 0, 1] : mode === 'ALTERNATING_BURST' ? [0, 0] : [0, 1],
    );
  });
  it('keeps born definitions while new shots consume changed parameters', () => {
    const p = definition();
    p.chargeup = 0;
    const state = createWeaponFirePreviewState();
    startWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 0.1, random);
    const next = { ...p, speed: 100 };
    advanceWeaponFirePreview(state, next, 0.2, random);
    expect(state.projectiles.map((o) => o.definition.speed)).toEqual([20, 100]);
    expect(state.projectiles[0]!.x).toBeCloseTo(6);
  });
  it('retains a noninterruptible burst after ceasefire and cancels an interruptible burst', () => {
    for (const interruptible of [false, true]) {
      const p = definition();
      p.chargeup = 0;
      p.interruptible = interruptible;
      const state = createWeaponFirePreviewState();
      startWeaponFirePreview(state);
      advanceWeaponFirePreview(state, p, 0.1, random);
      stopWeaponFirePreview(state);
      advanceWeaponFirePreview(state, p, 0.3, random);
      expect(state.projectiles).toHaveLength(interruptible ? 1 : 2);
    }
  });
  it('integrates missile acceleration and lifetime independently of frame rate', () => {
    const p = createWeaponFirePreviewDefinition(
      { 'launch speed': 10, 'proj speed': 20, 'flight time': 1, chargedown: 10 },
      {},
      { specClass: 'missile', missileType: 'ROCKET', engineSpec: { acc: 20 }, flameoutTime: 0.5, fadeTime: 0.2 },
      'turret',
    );
    const simulate = (step: number) => {
      const state = createWeaponFirePreviewState();
      startWeaponFirePreview(state);
      for (let i = 0; i < 1 / step; i++) advanceWeaponFirePreview(state, p, step, random);
      return state;
    };
    const coarse = simulate(0.25),
      fine = simulate(0.05);
    expect(coarse.projectiles[0]!.x).toBeCloseTo(fine.projectiles[0]!.x);
    expect(coarse.projectiles[0]!.x).toBeCloseTo(27.5);
    stopWeaponFirePreview(coarse);
    advanceWeaponFirePreview(coarse, p, 0.6, random);
    expect(coarse.projectiles).toHaveLength(0);
  });
  it('fades a projectile after range and freezes the complete paused state', () => {
    const p = definition();
    p.range = 2;
    p.flightTime = 0.1;
    p.chargeup = 0;
    p.burstSize = 1;
    const state = createWeaponFirePreviewState();
    startWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 0.35, random);
    expect(state.projectiles[0]!.alpha).toBeCloseTo(0.5);
    state.running = false;
    const before = JSON.stringify(state);
    advanceWeaponFirePreview(state, p, 1, random);
    expect(JSON.stringify(state)).toBe(before);
    state.running = true;
    stopWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 0.3, random);
    expect(state.projectiles).toHaveLength(0);
  });
  it('charges, extends, discharges and restarts continuous beams', () => {
    const p = createWeaponFirePreviewDefinition(
        { chargeup: 1, chargedown: 0.5, 'beam speed': 100, range: 1000 },
        { specClass: 'beam' },
        {},
        'turret',
      ),
      state = createWeaponFirePreviewState();
    startWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 0.5, random);
    expect(state.beam.alpha).toBe(0.5);
    expect(state.beam.length).toBe(50);
    stopWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 0.125, random);
    expect(state.beam.alpha).toBe(0.25);
    advanceWeaponFirePreview(state, p, 0.125, random);
    expect(state.beam.alpha).toBe(0);
    startWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 1, random);
    expect(state.beam.alpha).toBe(1);
  });
  it('keeps fractional pulse durations and zero-delay cycles finite', () => {
    const p = createWeaponFirePreviewDefinition(
        { 'burst size': 0.2, 'burst delay': 0, chargeup: 0, chargedown: 0 },
        { specClass: 'beam', skipIdleFrameIfZeroBurstDelay: true },
        {},
        'turret',
      ),
      state = createWeaponFirePreviewState();
    startWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 0.55, random);
    expect(state.beam.phase).toBe('burst');
    expect(state.beam.timer).toBeCloseTo(0.05);
    p.skipIdle = false;
    advanceWeaponFirePreview(state, p, 0.1, random);
    expect(state.beam.phase).toBe('cooldown');
    expect(state.beam.alpha).toBe(0);
  });
  it('captures an automatic explosion at the expiration position', () => {
    const p = createWeaponFirePreviewDefinition(
        { range: 2, 'proj speed': 10, chargedown: 10 },
        {},
        {
          fadeTime: 0.1,
          behaviorSpec: {
            behavior: 'PROXIMITY_FUSE',
            explosionSpec: { duration: 0.5, radius: 20, particleCount: 2, particleDuration: 0.5 },
          },
        },
        'turret',
      ),
      state = createWeaponFirePreviewState();
    startWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 0.1, random);
    stopWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 0.15, random);
    expect(state.projectiles).toHaveLength(0);
    expect(state.effects).toHaveLength(1);
    const x = state.effects[0]!.x;
    expect(x).toBeCloseTo(p.barrels[0]!.x + 2);
    expect(state.effects[0]!.age).toBeCloseTo(0.05);
    advanceWeaponFirePreview(state, p, 0.2, random);
    expect(state.effects[0]!.x).toBe(x);
  });
  it('recovers spread during a burst and after ceasefire', () => {
    const p = definition();
    Object.assign(p, { chargeup: 0, minSpread: 0, maxSpread: 10, spreadPerShot: 4, spreadDecay: 2 });
    const state = createFiringState();
    scheduleShots(state, p, 0.3, true, random);
    expect(state.spread).toBeCloseTo(7.4);
    scheduleShots(state, p, 1, false, random);
    expect(state.spread).toBeCloseTo(5.4);
  });
  it('preserves the beam phase fraction when accepting changed timing', () => {
    const p = createWeaponFirePreviewDefinition({ chargeup: 1, range: 1000, 'beam speed': 100 }, { specClass: 'beam' }, {}, 'turret');
    const state = createWeaponFirePreviewState();
    startWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 0.5, random);
    const next = { ...p, chargeup: 2 };
    advanceWeaponFirePreview(state, next, 0, random);
    expect(state.beam.alpha).toBe(0.5);
    expect(state.beam.timer).toBe(1);
    expect(state.beam.length).toBe(50);
    advanceWeaponFirePreview(state, next, 0.5, random);
    expect(state.beam.alpha).toBe(0.75);
  });
  it('drives weapon glow through idle, charging, burst and cooldown', () => {
    const p = definition(),
      state = createWeaponFirePreviewState();
    expect(weaponGlowLevel(state, p)).toBe(0);
    startWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 0.25, random);
    expect(weaponGlowLevel(state, p)).toBe(0.5);
    advanceWeaponFirePreview(state, p, 0.25, random);
    expect(weaponGlowLevel(state, p)).toBe(1);
    advanceWeaponFirePreview(state, p, 0.75, random);
    expect(weaponGlowLevel(state, p)).toBe(0.5);
    stopWeaponFirePreview(state);
    advanceWeaponFirePreview(state, p, 0.5, random);
    expect(weaponGlowLevel(state, p)).toBe(0);
    p.beam = true;
    state.beam.alpha = 0.3;
    expect(weaponGlowLevel(state, p)).toBe(0.3);
  });
});
