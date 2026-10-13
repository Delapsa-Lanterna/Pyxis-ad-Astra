import { describe, expect, it } from 'vitest';
import { variantJointFixture } from '@/test/variant-joint-edit';
import { projectVariantPanel, variantEditableRecords, variantOpSegments } from './variant-panel';
import { jointObject } from '@/domain/joint-edit';
import { equipVariantWing, setVariantHullmod } from './variant-actions';
describe('variant base configuration projection', () => {
  it.each([
    [0, 165, 0, 0],
    [65, 165, 65 / 165, 0],
    [165, 165, 1, 0],
    [200, 165, 0.825, 0.175],
    [330, 165, 0.5, 0.5],
    [10, 0, 0, 1],
    [0, 0, 0, 0],
    [NaN, 165, 0, 0],
  ])('projects the original OP bar segments for %s/%s', (used, total, within, overflow) => {
    expect(variantOpSegments(used, total)).toEqual({ within, overflow });
  });
  it('matches Aurora base values and counts built-ins without OP', () => {
    const snapshot = variantJointFixture(),
      values = { variant: snapshot.records.find((record) => record.key === 'variant')!.value };
    const variant = projectVariantPanel(snapshot, values).variants[0]!;
    expect(variant).toMatchObject({ opTotal: 165, opUsed: 71, capacity: 11800, dissipation: 800, capacitors: 4, vents: 0, fluxLimit: 30 });
    expect(variant.stats.slice(0, 3).map((stat) => stat.display)).toEqual(['80', '800', '8000']);
    expect(variant.weapons.map((weapon) => weapon.cost)).toEqual([0, 10]);
    expect(variant.stats.at(-1)!.display).toBe('800');
    expect(variantEditableRecords(snapshot)).toEqual(['variant']);
  });
  it('keeps zero plugin effects and uses configured flux increments', () => {
    const snapshot = variantJointFixture();
    const data = setVariantHullmod(jointObject(snapshot.records.find((record) => record.key === 'variant')!.value), 'rangefinder', 's');
    snapshot.referenceSettings.values = { fluxPerCapacitor: 300, dissipationPerVent: 15 };
    const variant = projectVariantPanel(snapshot, { variant: { state: 'present', value: { ...data, fluxVents: 10 } } }).variants[0]!;
    expect(variant).toMatchObject({ opUsed: 36, capacity: 12200, dissipation: 950 });
    expect(variant.mods[0]!).toMatchObject({ category: 's', cost: 0 });
    expect(variant.stats[0]!.display).toBe('80');
  });
  it('retains excess bays and reports unknown costs and flux limits', () => {
    const snapshot = variantJointFixture();
    const data = equipVariantWing(jointObject(snapshot.records.find((record) => record.key === 'variant')!.value), 2, 'missing');
    const variant = projectVariantPanel(snapshot, { variant: { state: 'present', value: { ...data, fluxCapacitors: 31 } } }).variants[0]!;
    expect(variant.wings.map((wing) => wing.id)).toEqual(['sarissa_wing', '', 'missing']);
    expect(variant.opUsed).toBeNaN();
    expect(variant.diagnostics).toContain('幅能分配超过舰级基础上限 30');
  });
});
