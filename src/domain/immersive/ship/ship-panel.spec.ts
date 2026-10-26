import { describe, it, expect } from 'vitest';
import { shipJointFixture } from '@/test/fixtures/joint-edit/ship-joint-edit';
import { jointFixtureValues, fixtureSpecRecord, fixtureCsvRecord } from '@/test/fixtures/joint-edit/joint-record';
import { projectShipPanel } from './ship-panel';
import { updateImmersiveField } from '../fields';
import { variantJointFixture } from '@/test/fixtures/joint-edit/variant-joint-edit';
import { jointObject } from '@/domain/joint-edit';
import { projectVariantPanel } from '../variant/variant-panel';

describe('ship original configuration projection', () => {
  it('projects current Variant equipment, OP and flux allocation from the same draft', () => {
    const snapshot = variantJointFixture();
    const values = Object.fromEntries(snapshot.records.map((record) => [record.key, structuredClone(record.value)]));
    const variant = values.variant!;
    values.variant = { state: 'present', value: { ...jointObject(variant), fluxCapacitors: 6, fluxVents: 2, permaMods: ['rangefinder'] } };
    const current = projectVariantPanel(snapshot, values).variants[0]!;
    const panel = projectShipPanel(snapshot, values, snapshot, current);
    expect(panel.heading[0]!.display).toBe('Aurora · Assault');
    expect(panel.combat.find((stat) => stat.id === 'max flux')!.display).toBe('12200');
    expect(panel.combat.find((stat) => stat.id === 'flux dissipation')!.display).toBe('820');
    expect(panel.combat.find((stat) => stat.id === 'shield upkeep')!.display).toBe('400');
    expect(panel.logistics[0]!.find((stat) => stat.id === 'ordnance points')!.display).toBe('30 / 165');
    expect(panel.equipment.find((row) => row.label === '军备详情')!.text).toBe('1× Assault Chaingun（内置），1× Assault Chaingun');
    expect(panel.equipment.find((row) => row.label === '战机联队')!.text).toContain('战机甲板 1');
    expect(panel.equipment.find((row) => row.label === '船体插件')!.text).toBe('Safety Overrides（永久）');
    expect(jointObject(snapshot.records.find((record) => record.key === 'variant')!.value).fluxCapacitors).toBe(4);
  });
  it('selects module, Skin, description and logistics through their actual hull bindings', () => {
    const snapshot = variantJointFixture();
    snapshot.records.push(
      fixtureSpecRecord('system', 'system', { id: 'ammofeed' }),
      fixtureCsvRecord('system-csv', 'shipSystems', { id: 'ammofeed' }, { id: 'ammofeed', name: 'Accelerated Ammo Feeder' }),
    );
    const hull = structuredClone(snapshot.hull!);
    const original = snapshot.records.find((record) => record.key === 'variant')!;
    const module = structuredClone(original);
    module.key = 'module';
    if (module.target.kind !== 'spec') throw new Error('Variant fixture');
    module.target.target.id = 'module';
    module.value = { state: 'present', value: { variantId: 'module', displayName: 'Module' } };
    snapshot.records.push(module);
    original.value = { state: 'present', value: { ...jointObject(original.value), modules: { MODULE: 'module' } } };
    const csv = structuredClone(snapshot.records.find((record) => record.key === 'csv')!);
    csv.key = 'module-csv';
    csv.value = { state: 'present', value: { ...jointObject(csv.value), designation: 'Cruiser', cargo: '120', 'supplies/mo': '20' } };
    const skin = structuredClone(snapshot.records.find((record) => record.key === 'spec')!);
    skin.key = 'skin';
    skin.value = { state: 'present', value: { hullName: 'Skin Hull', maxSpeed: 90 } };
    const description = structuredClone(snapshot.records.find((record) => record.key === 'description')!);
    description.key = 'skin-description';
    description.value = { state: 'present', value: { text1: 'Actual Skin description' } };
    snapshot.records.push(csv, skin, description);
    hull.variantKey = 'module';
    hull.skinKeys = ['skin'];
    hull.displayBindings = { csv: csv.key, description: description.key, system: 'system' };
    for (const field of Object.values(hull.fields)) field.recordKey = csv.key;
    hull.fields.name = { recordKey: skin.key, path: 'hullName' };
    hull.fields['max speed'] = { recordKey: skin.key, path: 'maxSpeed' };
    snapshot.variants.module = hull;
    const values = Object.fromEntries(snapshot.records.map((record) => [record.key, record.value]));
    const current = projectVariantPanel(snapshot, values).variants.find((variant) => variant.key === 'module')!;
    const panel = projectShipPanel(snapshot, values, snapshot, current);
    expect(panel.heading.map((stat) => stat.display)).toEqual(['Skin Hull · Module', 'Cruiser', 'High Tech']);
    expect(panel.description.display).toBe('Actual Skin description');
    expect(panel.logistics[1]!.find((stat) => stat.id === 'cargo')!.display).toBe('120');
    expect(panel.combat.find((stat) => stat.id === 'max speed')!.display).toBe('90');
    expect(panel.system.display).toBe('Accelerated Ammo Feeder');
    delete hull.displayBindings.description;
    expect(projectShipPanel(snapshot, values, snapshot, current).description.display).toBe('描述未提供');
  });
  it('uses original missing-column defaults and the loader recovery-rate precedence', () => {
    const snapshot = shipJointFixture();
    const values = jointFixtureValues(snapshot);
    const csv = values.csv!;
    if (csv.state !== 'present') throw new Error('CSV fixture');
    const data = csv.value as Record<string, import('@/shared/types').JsonValue>;
    delete data['cr %/day'];
    data['repair %/day'] = '9';
    expect(projectShipPanel(snapshot, values).logistics[0]!.find((stat) => stat.label === '战备恢复速率 (每天)')!.display).toBe('9%');
    data['cr %/day'] = '';
    expect(projectShipPanel(snapshot, values).logistics[0]!.find((stat) => stat.label === '战备恢复速率 (每天)')!.display).toBe('20%');
    data['armor rating'] = '0';
    data['CR loss/sec'] = '-1';
    data['phase cost'] = '0.1';
    data['phase upkeep'] = '0.02';
    data['shield type'] = 'PHASE';
    const panel = projectShipPanel(snapshot, values);
    expect(panel.combat.find((stat) => stat.id === 'armor rating')!.display).toBe('1');
    expect(panel.logistics[0]!.find((stat) => stat.id === 'peak CR sec')!.display).toBe('无限');
    expect(panel.combat.find((stat) => stat.id === 'phase cost')!.display).toBe('210');
    expect(panel.combat.find((stat) => stat.id === 'phase upkeep')!.display).toBe('42');
  });
  it('uses original CSV and base formulas rather than fleet state', () => {
    const snapshot = shipJointFixture();
    const panel = projectShipPanel(snapshot, jointFixtureValues(snapshot));
    expect(panel.logistics[0]!.find((stat) => stat.id === 'deployment-points')!.display).toBe('4');
    expect(panel.combat.find((stat) => stat.id === 'shield upkeep')!.display).toBe('56');
    expect(panel.logistics[0]!.find((stat) => stat.id === 'crew')!.display).toBe('25 / 50');
    expect(panel.logistics[1]!.find((stat) => stat.id === 'sensor-profile')!.display).toBe('30');
    expect(panel.logistics[1]!.find((stat) => stat.id === 'sensor-profile')!.fields[0]!.schema.key).toBe('hullSize');
    expect(panel.mounts).toBe('2× 小型导弹，5× 小型实弹');
    expect(panel.armaments).toBe('2× Weapon name');
    expect(panel.hullmods).toBe('Ballistic Rangefinder');
    expect(panel.system.display).toBe('Accelerated Ammo Feeder');
    expect(panel.systemDescription).toBe('Brief ballistic boost');
    expect(panel.description.fields.map((field) => field.schema.key)).toEqual(['text1', 'text2', 'text3', 'text4', 'text5']);
  });
  it('changes phase and missing-input projections while preserving unknown source data', () => {
    const snapshot = shipJointFixture();
    let values = jointFixtureValues(snapshot);
    const field = projectShipPanel(snapshot, values).combat.find((stat) => stat.id === 'shield type')!.fields[0]!;
    values = updateImmersiveField(
      values,
      snapshot.records.find((record) => record.key === 'csv')!,
      field,
      { kind: 'set', value: 'PHASE' },
    );
    expect(projectShipPanel(snapshot, values).combat.some((stat) => stat.id === 'phase cost')).toBe(true);
    expect(projectShipPanel(snapshot, values).combat.some((stat) => stat.id === 'shield upkeep')).toBe(false);
    expect(snapshot.records.find((record) => record.key === 'csv')!.value).not.toEqual(values.csv);
    expect(values.spec).toMatchObject({ state: 'present', value: { custom: 'retained' } });
  });
  it('retains invalid source diagnostics and exposes missing settings without a substitute number', () => {
    const snapshot = shipJointFixture();
    const values = jointFixtureValues(snapshot);
    if (values.csv!.state === 'present') {
      const value = values.csv!.value as Record<string, import('@/shared/types').JsonValue>;
      value.hitpoints = 'unfinished';
    }
    snapshot.referenceSettings.values = {};
    const panel = projectShipPanel(snapshot, values);
    expect(panel.combat.find((stat) => stat.id === 'hitpoints')).toMatchObject({
      display: '无有效值',
      diagnostic: 'hitpoints 不是有效数字',
    });
    expect(panel.logistics[1]!.find((stat) => stat.id === 'sensor-strength')!.display).toBe('来源未提供');
  });
});
