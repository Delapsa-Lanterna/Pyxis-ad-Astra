import { describe, expect, it } from 'vitest';
import {
  createWeaponPreviewParams,
  beginPreviewBeamCharge,
  advancePreviewBeam,
  advancePreviewProjectiles,
  type BeamPreviewState,
  type ProjectilePreviewState,
} from './weapon-preview';

describe('weapon preview progression', () => {
  it('advances charge and discharge without mutating the previous beam state', () => {
    const params = createWeaponPreviewParams({ chargeup: 1, chargedown: 0.5 }, { specClass: 'beam' }, {}, 'turret');
    const idle: BeamPreviewState = { alpha: 0, phase: 'idle', length: 0, offset: 0, timer: 0 };
    const charged = advancePreviewBeam(beginPreviewBeamCharge(idle, params), params, 1, true);
    expect(charged.phase).toBe('burst');
    expect(charged.alpha).toBe(1);
    const fading = advancePreviewBeam(charged, params, 0.25, false);
    expect(fading.phase).toBe('chargedown');
    expect(fading.alpha).toBe(0.5);
    expect(advancePreviewBeam(fading, params, 0.25, false).phase).toBe('idle');
    expect(idle.phase).toBe('idle');
    expect(charged.alpha).toBe(1);
  });

  it('advances missile movement and expires its explosion while preserving the earlier frame', () => {
    const params = createWeaponPreviewParams({ range: 5 }, {}, { specClass: 'missile', engineSpec: { acc: 10, maxSpeed: 100 } }, 'turret');
    const source: ProjectilePreviewState = {
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
    const next = advancePreviewProjectiles([source], params, 0.25, 1, 0, 1);
    expect(next[0]!.x).toBe(3.125);
    expect(next[0]!.exploding).toBe(true);
    expect(next[0]!.trail).toHaveLength(1);
    expect(advancePreviewProjectiles(next, params, 0.25, 1, 0, 1)).toEqual([]);
    expect(source.x).toBe(0);
    expect(source.trail).toEqual([]);
  });
});
