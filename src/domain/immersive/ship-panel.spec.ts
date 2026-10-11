import { describe, it, expect } from 'vitest';
import { shipJointFixture, jointFixtureValues } from '@/test/joint-edit';
import { projectShipPanel } from './ship-panel';
import { updateImmersiveField } from './fields';

describe('ship original configuration projection', () => {
  it('uses original missing-column defaults and the loader recovery-rate precedence', () => {
    const snapshot = shipJointFixture();
    const values = jointFixtureValues(snapshot);
    const csv = values.csv!;
    if (csv.state !== 'present') throw new Error('CSV fixture');
    const data = csv.value as Record<string, import('@/shared/types').JsonValue>;
    delete data['cr %/day'];
    data['repair %/day'] = '9';
    expect(projectShipPanel(snapshot, values).logistics[0]!.find((stat) => stat.label === '每日战备恢复')!.display).toBe('9%');
    data['cr %/day'] = '';
    expect(projectShipPanel(snapshot, values).logistics[0]!.find((stat) => stat.label === '每日战备恢复')!.display).toBe('20%');
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
