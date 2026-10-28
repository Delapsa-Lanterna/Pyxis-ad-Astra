import { describe, expect, it } from 'vitest';
import { skinJointFixture } from '@/test/fixtures/joint-edit/skin-joint-edit';
import { jointFixtureValues } from '@/test/fixtures/joint-edit/joint-record';
import { jointObject } from '@/domain/joint-edit';
import { hullDataIndex, hullFieldValue } from './hull-fields';
import { projectShipPanel } from './ship/ship-panel';
import { updateImmersiveField } from './fields';

describe('ordered hull source fields', () => {
  it.each([
    ['name', 'hullName', 'Base', 'Custom Fighter'],
    ['designation', 'hullDesignation', 'Fighter', 'Scout'],
    ['tech/manufacturer', 'tech', 'Low Tech', 'High Tech'],
    ['system id', 'systemId', 'base_system', 'custom_system'],
    ['fleet pts', 'fleetPoints', '6', 9],
    ['ordnance points', 'ordnancePoints', '30', 40],
    ['base value', 'baseValue', '1000', 1250],
    ['supplies/rec', 'suppliesToRecover', '4', 5],
    ['supplies/mo', 'suppliesPerMonth', '2', 3],
    ['fighter bays', 'fighterBays', '1', 0],
    ['max speed', 'maxSpeed', '140', 180],
    ['shield efficiency', 'shieldEfficiency', '1', 0.6],
  ])('resolves %s and offers each original source independently', (key, path, base, effective) => {
    const graph = skinJointFixture(),
      values = jointFixtureValues(graph);
    values['hull-csv'] = { state: 'present', value: { ...jointObject(values['hull-csv']), [key]: base } };
    values.skin = { state: 'present', value: { ...jointObject(values.skin), [path]: key === 'base value' ? 1000 : effective } };
    expect(hullFieldValue(graph.hull!.fields[key], hullDataIndex(graph.records, values))).toBe(effective);
    values['hull-csv'] = { state: 'present', value: { ...jointObject(values['hull-csv']), 'shield type': 'OMNI' } };
    const panel = projectShipPanel(graph, values);
    const fields = panel.allStats.flatMap((stat) => stat.fields);
    expect(fields).toContainEqual(expect.objectContaining({ recordKey: 'hull-csv', schema: expect.objectContaining({ key }) }));
    expect(fields).toContainEqual(
      expect.objectContaining({ recordKey: 'skin', inheritOnEmpty: true, schema: expect.objectContaining({ key: path }) }),
    );
  });
  it('applies fleet increments and value multiplication across the complete skin chain', () => {
    const graph = skinJointFixture(),
      values = jointFixtureValues(graph);
    const inputs = [
      { recordKey: 'hull-csv', path: 'fleet pts' },
      { recordKey: 'parent', path: 'fleetPoints' },
      { recordKey: 'parent', path: 'fpMod' },
      { recordKey: 'skin', path: 'fleetPoints' },
      { recordKey: 'skin', path: 'fpMod' },
    ];
    const data = { 'hull-csv': { 'fleet pts': '4' }, parent: { fleetPoints: 7, fpMod: 99 }, skin: { fpMod: -2 } };
    expect(hullFieldValue(inputs, new Map(Object.entries(data)))).toBe(5);
    const valueInputs = inputs.map((input) => ({
      ...input,
      path: input.path === 'fleet pts' ? 'base value' : input.path === 'fleetPoints' ? 'baseValue' : 'baseValueMult',
    }));
    const prices = { 'hull-csv': { 'base value': '800' }, parent: { baseValue: 1001, baseValueMult: 1.25 }, skin: { baseValueMult: 0.5 } };
    expect(hullFieldValue(valueInputs, new Map(Object.entries(prices)))).toBe(625);
    const field = projectShipPanel(graph, values).combat.find((stat) => stat.id === 'max speed')!.fields[1]!;
    const cleared = updateImmersiveField(
      values,
      graph.records.find((record) => record.key === 'skin')!,
      field,
      { kind: 'remove' },
    );
    expect(projectShipPanel(graph, cleared).combat.find((stat) => stat.id === 'max speed')!.display).toBe('140');
    expect(jointObject(values.skin).maxSpeed).toBe(180);
  });
});
