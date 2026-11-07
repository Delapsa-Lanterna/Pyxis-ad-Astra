import { describe, expect, it } from 'vitest';
import type { RowData } from '@/shared/types';
import { weaponStatistics, weaponMissileSpeed, weaponMissileTracking, weaponAccuracy, weaponTurnRate } from './weapon-statistics';

describe('original weapon base statistics', () => {
  it('matches Assault Chaingun damage, DPS and flux', () => {
    expect(
      weaponStatistics(
        { 'damage/shot': '75', chargedown: '0.15', 'energy/shot': '60' },
        { specClass: 'projectile', barrelMode: 'ALTERNATING' },
        {},
      ),
    ).toMatchObject({ damage: 75, dps: 500, fluxPerSecond: 400, fluxRatio: 0.8 });
  });
  it.each([
    ['ALTERNATING', [10, 0, 20, 0], 100],
    ['DUAL', [10, 0], 200],
    ['LINKED', [10, 0, 20, 0, 30, 0], 300],
  ])('uses %s firing barrels with ammo regeneration', (barrelMode, turretOffsets, expected) => {
    const stats = weaponStatistics(
      { 'damage/shot': '100', chargedown: '2', 'burst size': '2', 'burst delay': '0.5', ammo: '20', 'ammo/sec': '1' },
      { specClass: 'projectile', barrelMode, turretOffsets },
      {},
    );
    expect(stats.dps).toBe((expected * 2) / 2.5);
    expect(stats.sustained).toBe(100);
  });
  it('uses continuous beam damage and flux per second', () => {
    const stats = weaponStatistics({ 'damage/second': '200', 'energy/second': '100', emp: '30' }, { specClass: 'beam' }, {});
    expect(stats).toMatchObject({ dps: 200, sustained: 200, fluxRatio: 0.5, emp: 30, burstDamage: -1 });
  });
  it('accounts for burst beam charge, decay, cycle and regenerated charges', () => {
    const stats = weaponStatistics(
      {
        'damage/second': '100',
        'energy/second': '50',
        chargeup: '1',
        chargedown: '1',
        'burst size': '2',
        'burst delay': '3',
        ammo: '10',
        'ammo/sec': '0.1',
      },
      { specClass: 'beam', beamFireOnlyOnFullCharge: true },
      {},
    );
    expect(stats.burstDamage).toBeCloseTo(233.3);
    expect(stats.dps).toBeCloseTo(233.3 / 7);
    expect(stats.sustained).toBeCloseTo(23.33);
    expect(stats.fluxRatio).toBeCloseTo(150 / 233.3);
  });
  it.each([
    [36, 1, 36],
    [36, 3, 108],
    [0, 4, 0],
    [36, 0, 0],
  ])('uses raw MIRV damage %s and count %s', (damage, numShots, expected) => {
    const stats = weaponStatistics(
      { 'damage/shot': '11', chargedown: '2', 'energy/shot': '0' },
      { specClass: 'projectile' },
      { missileType: 'MIRV', behaviorSpec: { damage, numShots, emp: 12 } },
    );
    expect(stats).toMatchObject({ damage: expected, dps: expected / 2, emp: 0, sustainedFlux: 0, diagnostics: '' });
    expect(stats.submunitions).toEqual({ damage, numShots, emp: 12 });
  });
  it.each([
    [{ damage: 36, emp: 12 }, 'numShots'],
    [{ numShots: 3, emp: 12 }, 'damage'],
    [undefined, 'damage、numShots、emp'],
  ] satisfies Array<[RowData | undefined, string]>)('keeps CSV damage for incomplete MIRV parameters %s', (behaviorSpec, missing) => {
    const stats = weaponStatistics(
      { 'damage/shot': '11', chargedown: '2', 'energy/shot': '6' },
      { specClass: 'projectile' },
      { missileType: 'MIRV', ...(behaviorSpec ? { behaviorSpec } : {}) },
    );
    expect(stats).toMatchObject({ damage: 11, dps: 5.5, sustainedFlux: 3, submunitions: null });
    expect(stats.diagnostics).toContain(missing);
  });
  it('retains derived MIRV damage while diagnosing unavailable display EMP', () => {
    const stats = weaponStatistics(
      { 'damage/shot': '11', chargedown: '2' },
      { specClass: 'projectile' },
      { missileType: 'MIRV', behaviorSpec: { damage: 36, numShots: 3 } },
    );
    expect(stats).toMatchObject({ damage: 108, dps: 54, submunitions: null });
    expect(stats.diagnostics).toContain('emp');
  });
  it('uses original display thresholds and missile engine maneuverability', () => {
    expect([125, 175, 225, 275, 276].map(weaponMissileSpeed)).toEqual(['非常慢', '较慢', '中等', '较快', '非常快']);
    expect(weaponMissileTracking(200, { missileType: 'MIRV', engineSpec: { acc: 200, turnRate: 180 } })).toBe('优秀');
    expect(weaponMissileTracking(200, { missileType: 'TORPEDO' })).toBe('无');
    expect([0, 2, 5, 10, 15, 20, 21].map(weaponAccuracy)).toEqual(['完美', '优秀', '良好', '中等', '较差', '很差', '极差']);
    expect([0, 5, 15, 25, 35, 50, 51].map(weaponTurnRate)).toEqual(['无', '非常慢', '较慢', '中等', '较快', '非常快', '优秀']);
  });
});
