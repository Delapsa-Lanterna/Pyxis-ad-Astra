import { describe, expect, it } from 'vitest';
import { variantJointFixture } from '@/test/fixtures/joint-edit/variant-joint-edit';
import { fixtureCsvRecord, fixtureSpecRecord } from '@/test/fixtures/joint-edit/joint-record';
import { projectVariantPanel, variantOpSegments, variantPreviewInputs } from './variant-panel';
import { immersiveSnapshotScene } from '../hull-scene';
import { variantEditableRecords } from '../source-records';
import { jointObject } from '@/domain/joint-edit';
import { equipVariantWing, setVariantHullmod } from './variant-actions';
import type { RowData } from '@/shared/types';

describe('variant base configuration projection', () => {
  it.each([
    ['FIGHTER', 5],
    ['FRIGATE', 10],
    ['DESTROYER', 20],
    ['CRUISER', 30],
    ['CAPITAL_SHIP', 50],
  ])('projects the %s allocation limit as %s', (hullSize, limit) => {
    const snapshot = variantJointFixture();
    const values = {
      spec: {
        state: 'present' as const,
        value: { ...jointObject(snapshot.records.find((record) => record.key === 'spec')!.value), hullSize },
      },
    };
    expect(projectVariantPanel(snapshot, values).variants[0]!.fluxLimit).toBe(limit);
  });
  it.each([
    ['DECORATIVE', 'ENERGY', '800'],
    ['ENERGY', 'DECORATIVE', '803'],
  ])('sums flux by weapon type %s in slot type %s', (type, slotType, expected) => {
    const snapshot = variantJointFixture(),
      hull = snapshot.hull!;
    snapshot.records.push(
      fixtureSpecRecord('aux-spec', 'weapon', { id: 'fixture_aux', specClass: type === 'DECORATIVE' ? 'beam' : 'projectile', type }),
      fixtureCsvRecord(
        'aux-csv',
        'weapons',
        { id: 'fixture_aux' },
        { id: 'fixture_aux', name: 'Auxiliary', 'damage/shot': '36', 'energy/shot': '6.5', chargedown: '2' },
      ),
    );
    hull.slots.push({ id: 'AUX', type: slotType, size: 'SMALL', mount: 'TURRET', locations: [0, 0] });
    hull.weapons.AUX = 'fixture_aux';
    hull.builtInWeapons.AUX = 'fixture_aux';
    const panel = projectVariantPanel(snapshot, {}).variants[0]!,
      flux = panel.stats.at(-1)!;
    expect(flux.display).toBe(expected);
    expect(flux.formula!.includes('Auxiliary')).toBe(type !== 'DECORATIVE');
    expect(panel.weapons.map((weapon) => weapon.id)).toEqual(['chaingun', 'chaingun', 'fixture_aux']);
  });
  it('normalizes equipment ordering while retaining referenced content changes', () => {
    const snapshot = variantJointFixture();
    const data = {
      hullId: 'hull',
      modules: { A: 'module' },
      weaponGroups: [{ weapons: { B: 'two', A: 'one' } }],
      wings: ['wing'],
      hullMods: ['z', 'a'],
      permaMods: ['a'],
    };
    const values = { variant: { state: 'present' as const, value: data } };
    const baseline = variantPreviewInputs(snapshot, values);
    const reordered = { ...data, weaponGroups: [{ weapons: { A: 'one', B: 'two' } }], hullMods: ['a', 'z'] };
    expect(variantPreviewInputs(snapshot, { variant: { state: 'present', value: reordered } })).toEqual(baseline);
    expect(variantPreviewInputs(snapshot, { variant: { state: 'present', value: { ...data, fluxVents: 10 } } })).toEqual(baseline);
    const updates: RowData[] = [
      { hullId: 'other' },
      { modules: { A: 'other' } },
      { weaponGroups: [{ weapons: { A: 'other' } }] },
      { wings: ['other'] },
      { sMods: ['other'] },
    ];
    for (const update of updates) {
      expect(variantPreviewInputs(snapshot, { variant: { state: 'present', value: { ...data, ...update } } })).not.toEqual(baseline);
    }
    expect(variantPreviewInputs(snapshot, values)).toEqual(baseline);
  });
  it('shares effective hull and mounted weapon data with the lightweight scene projection', () => {
    const snapshot = variantJointFixture();
    const values = Object.fromEntries(snapshot.records.map((record) => [record.key, record.value]));
    values.spec = { state: 'present', value: { ...jointObject(values.spec), center: [98, 176] } };
    const panel = projectVariantPanel(snapshot, values).variants[0]!;
    const scene = immersiveSnapshotScene(snapshot, values)!;
    expect(scene.key).toBe(panel.key);
    expect(scene.spec.center).toEqual([98, 176]);
    expect(scene.hull).toBe(panel.hull);
    expect(scene.weapons.map((weapon) => [weapon.id, weapon.builtin, weapon.layers, weapon.loadedMissile])).toEqual(
      panel.weapons.map((weapon) => [weapon.id, weapon.builtin, weapon.layers, weapon.loadedMissile]),
    );
    expect(jointObject(snapshot.records.find((record) => record.key === 'spec')!.value).center).toEqual([100, 180]);
  });
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
    expect(variant.diagnostics).toContain('幅能分配超过船体级别基础上限 30');
  });
});
