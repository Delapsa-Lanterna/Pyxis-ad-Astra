import { wingJointFixture } from './wing-joint-edit';
import { fixtureSpecRecord, fixtureCsvRecord } from './joint-record';
import mappings from '../../../../schemas/skin-hull-fields.json';

export function skinJointFixture() {
  const snapshot = wingJointFixture();
  const skin = fixtureSpecRecord('skin', 'skin', {
    skinHullId: 'sarissa_custom',
    baseHullId: 'sarissa',
    hullName: 'Custom Fighter',
    maxSpeed: 180,
    baseValueMult: 1.25,
    tech: 'High Tech',
    spriteName: 'graphics/ships/custom.png',
  });
  snapshot.records.push(
    skin,
    fixtureCsvRecord(
      'skin-description',
      'descriptions',
      { id: 'sarissa_custom', type: 'SHIP' },
      { id: 'sarissa_custom', type: 'SHIP', text1: 'Custom fighter hull.' },
    ),
  );
  snapshot.root = { ...snapshot.root, kind: 'skin', id: 'sarissa_custom' };
  snapshot.bindings = { spec: 'skin', csv: 'hull-csv', description: 'skin-description', system: 'system' };
  const hull = snapshot.hull!;
  hull.spec = { ...hull.spec, hullId: 'sarissa_custom', spriteName: 'graphics/ships/custom.png' };
  hull.variantKey = 'skin';
  hull.skinKeys = ['skin'];
  hull.displayBindings.description = 'skin-description';
  for (const [column, paths] of Object.entries(mappings)) {
    hull.fields[column] = [{ recordKey: 'hull-csv', path: column }, ...paths.map((path) => ({ recordKey: 'skin', path }))];
  }
  return snapshot;
}
