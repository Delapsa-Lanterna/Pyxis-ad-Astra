import { describe, it, expect } from 'vitest';
import { fixtureSpecRecord } from '@/test/fixtures/joint-edit/joint-record';
import { wingJointFixture } from '@/test/fixtures/joint-edit/wing-joint-edit';
import { immersiveEditableRecords } from '../source-records';
import { projectWingPanel } from './wing-panel';
import { updateImmersiveField } from '../fields';
import { jointObject } from '@/domain/joint-edit';

function fixture() {
  const snapshot = wingJointFixture();
  const values = Object.fromEntries(
    snapshot.records
      .filter((record) => immersiveEditableRecords(snapshot).includes(record.key))
      .map((record) => [record.key, structuredClone(record.value)]),
  );
  return { snapshot, values };
}
describe('wing original data and source projection', () => {
  it('keeps input identities stable when the wing record key follows a CSV rename', () => {
    const { snapshot, values } = fixture(),
      before = projectWingPanel(snapshot, values).technical.find((stat) => stat.id === 'num')!.fields[0]!.id;
    snapshot.bindings.csv = 'renamed-wing';
    const record = snapshot.records.find((record) => record.key === 'wing')!;
    record.key = 'renamed-wing';
    values['renamed-wing'] = values.wing!;
    expect(projectWingPanel(snapshot, values).technical.find((stat) => stat.id === 'num')!.fields[0]!.id).toBe(before);
  });
  it('matches Sarissa values, title, system highlights and effective fitted weapons', () => {
    const { snapshot, values } = fixture(),
      panel = projectWingPanel(snapshot, values);
    expect(panel.heading[0]!.display).toBe('Sarissa Support Fighter');
    expect(panel.technical.map((stat) => stat.display)).toEqual(['Support', '12', '3', '0', '3', '10', '750', '200', '140']);
    expect(panel.technical.map((stat) => stat.id)).toEqual([
      'role',
      'op cost',
      'min crew',
      'range',
      'num',
      'refit',
      'hitpoints',
      'armor rating',
      'max speed',
    ]);
    expect(panel.armaments).toBe('2× Light Autocannon');
    expect(panel.system.display).toBe('Canister Flak');
    expect(panel.systemRuns).toContainEqual({ text: '200 High Explosive', color: '#ffd200' });
    expect(panel.heading[0]!.fields.map((field) => field.recordKey)).toEqual(['hull-csv', 'variant']);
    expect(panel).toMatchObject({ count: 3, formation: 'CLAW', preview: { key: 'variant', spec: { hullId: 'sarissa' } } });
  });
  it('edits the declared source and keeps query records and unknown variant fields independent', () => {
    const { snapshot, values } = fixture(),
      panel = projectWingPanel(snapshot, values);
    const field = panel.technical.find((stat) => stat.id === 'hitpoints')!.fields[0]!;
    const updated = updateImmersiveField(
      values,
      snapshot.records.find((record) => record.key === field.recordKey)!,
      field,
      { kind: 'set', value: 800 },
    );
    expect(projectWingPanel(snapshot, updated).technical.find((stat) => stat.id === 'hitpoints')!.display).toBe('800');
    expect(jointObject(values['hull-csv']).hitpoints).toBe('750');
    expect(jointObject(updated.variant).unknown).toBe('retained');
  });
  it('consumes original swarm, support, armor and shield display branches', () => {
    const { snapshot, values } = fixture();
    values.wing = { state: 'present', value: { ...jointObject(values.wing), tags: 'swarm_fighter', role: 'INTERCEPTOR', 'role desc': '' } };
    values['hull-csv'] = {
      state: 'present',
      value: { ...jointObject(values['hull-csv']), 'armor rating': '1', 'shield type': 'OMNI', 'max flux': '500' },
    };
    const panel = projectWingPanel(snapshot, values);
    expect(panel.technical.map((stat) => stat.id)).toEqual(['role', 'hitpoints', 'defense', 'max speed']);
    expect(panel.technical[0]!.display).toBe('截击机');
    expect(panel.technical.find((stat) => stat.id === 'defense')!.display).toBe('500');
  });
  it('uses Skin source bindings and keeps the linked ship CSV intact', () => {
    const { snapshot, values } = fixture();
    snapshot.hull!.fields['max speed'] = [{ recordKey: 'skin', path: 'maxSpeed' }];
    snapshot.records.push(fixtureSpecRecord('skin', 'skin', { skinHullId: 'skin', baseHullId: 'sarissa', maxSpeed: 190 }));
    values.skin = { state: 'present', value: { skinHullId: 'skin', maxSpeed: 190 } };
    const panel = projectWingPanel(snapshot, values);
    expect(panel.technical.find((stat) => stat.id === 'max speed')!).toMatchObject({
      display: '190',
      fields: [{ recordKey: 'skin', schema: { key: 'maxSpeed' } }],
    });
    expect(jointObject(values['hull-csv'])['max speed']).toBe('140');
  });
  it('shows a missing association while retaining wing controls and the variant repair source', () => {
    const { snapshot, values } = fixture();
    snapshot.hull = null;
    values.variant = { state: 'missing' };
    const panel = projectWingPanel(snapshot, values);
    expect(panel.technical.find((stat) => stat.id === 'hitpoints')!.display).toBe('来源未提供');
    expect(panel.sources[1]!.fields[0]!.schema.required).toBe(true);
    expect(panel.sources[1]!.fields[0]!.handoff).toBe(true);
    expect(panel.technical.find((stat) => stat.id === 'num')!.display).toBe('3');
    expect(panel.preview).toBeNull();
  });
  it('projects the current wing count and formation independently of swarm statistics', () => {
    const { snapshot, values } = fixture();
    values.wing = { state: 'present', value: { ...jointObject(values.wing), num: '4', formation: 'BOX', tags: 'swarm_fighter' } };
    const panel = projectWingPanel(snapshot, values);
    expect(panel.count).toBe(4);
    expect(panel.formation).toBe('BOX');
    expect(panel.technical.some((stat) => stat.id === 'num')).toBe(false);
    expect(jointObject(snapshot.records.find((record) => record.key === 'wing')!.value).num).toBe('3');
  });
});
