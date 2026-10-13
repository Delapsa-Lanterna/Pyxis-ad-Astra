import type { JointEditRecord, JointEditSnapshot } from '@/shared/types';
import { shipJointFixture } from './joint-edit';
import { weaponJointFixture } from './weapon-joint-edit';
import { entityTargetFixture } from './entity-target';
export function variantJointFixture(): JointEditSnapshot {
  const snapshot = shipJointFixture();
  snapshot.root = { ...snapshot.root, kind: 'variant', id: 'aurora_refit' };
  const hull = snapshot.records[0]!;
  hull.value = {
    state: 'present',
    value: {
      hullId: 'aurora',
      hullSize: 'CRUISER',
      width: 200,
      height: 360,
      center: [100, 180],
      weaponSlots: [
        { id: 'WS1', type: 'BALLISTIC', size: 'MEDIUM', mount: 'TURRET', angle: 90, arc: 120, locations: [0, 110] },
        { id: 'WS2', type: 'BALLISTIC', size: 'MEDIUM', mount: 'TURRET', angle: 90, arc: 120, locations: [-60, 20] },
      ],
      builtInWeapons: { WS1: 'chaingun' },
    },
  };
  const csv = snapshot.records[1]!;
  csv.value = {
    state: 'present',
    value: {
      id: 'aurora',
      name: 'Aurora',
      'tech/manufacturer': 'High Tech',
      'ordnance points': '165',
      hitpoints: '8000',
      'armor rating': '800',
      'max speed': '80',
      'max flux': '11000',
      'flux dissipation': '800',
      'fighter bays': '1',
      'shield type': 'OMNI',
      'shield arc': '180',
      'shield upkeep': '0.5',
      'shield efficiency': '0.6',
    },
  };
  const target = entityTargetFixture('variant', 'aurora_refit');
  const variant: JointEditRecord = {
    key: 'variant',
    target: { kind: 'spec', target },
    source: target.write,
    sourceVersion: { path: target.write.path, fingerprint: 'variant' },
    baseVersions: [{ path: target.write.path, fingerprint: 'variant' }],
    referencedBy: ['Variant:aurora_refit'],
    resourceRefs: {},
    value: {
      state: 'present',
      value: {
        variantId: 'aurora_refit',
        hullId: 'aurora',
        displayName: 'Assault',
        fluxCapacitors: 4,
        fluxVents: 0,
        hullMods: ['rangefinder'],
        permaMods: [],
        sMods: [],
        wings: ['sarissa_wing'],
        weaponGroups: [{ mode: 'LINKED', autofire: false, weapons: { WS2: 'chaingun' } }],
        custom: { retained: '007' },
      },
    },
  };
  const weapons = weaponJointFixture().records.map((record) => ({ ...record, key: 'weapon-' + record.key }));
  const wing: JointEditRecord = {
    ...csv,
    key: 'wing',
    target: { kind: 'csv', table: 'wings', rowKey: 'wing-row', identity: { id: 'sarissa_wing' }, write: csv.source! },
    value: {
      state: 'present',
      value: {
        id: 'sarissa_wing',
        variant: 'sarissa_Fighter',
        'role desc': 'Support',
        'op cost': '12',
        num: '3',
        formation: 'CLAW',
        refit: '10',
      },
    },
  };
  const mod = snapshot.records.find((record) => record.key === 'mod')!;
  mod.value = {
    state: 'present',
    value: {
      id: 'rangefinder',
      name: 'Safety Overrides',
      'tech/manufacturer': 'High Tech',
      cost_cruiser: '45',
      desc: 'Base configuration sample',
      uiTags: 'Weapons, Flux',
    },
  };
  snapshot.records = [...snapshot.records.filter((record) => record.key !== 'weapon'), variant, wing, ...weapons];
  snapshot.bindings = { spec: 'variant', variant: 'variant' };
  const hullData = hull.value.state === 'present' ? hull.value.value : null;
  snapshot.hull = {
    variantKey: 'variant',
    hullKey: 'spec',
    skinKeys: [],
    slots:
      hullData && typeof hullData === 'object' && !Array.isArray(hullData) && Array.isArray(hullData.weaponSlots)
        ? hullData.weaponSlots
        : [],
    fields: Object.fromEntries(
      [
        'name',
        'tech/manufacturer',
        'ordnance points',
        'hitpoints',
        'armor rating',
        'max speed',
        'max flux',
        'flux dissipation',
        'fighter bays',
        'shield type',
        'shield arc',
        'shield upkeep',
        'shield efficiency',
      ].map((path) => [path, { recordKey: 'csv', path }]),
    ),
    weapons: { WS1: 'chaingun', WS2: 'chaingun' },
    displayBindings: { csv: 'csv', description: 'description', system: 'system' },
    builtInWeapons: { WS1: 'chaingun' },
    builtInMods: [],
    builtInWings: [],
    modules: [],
    sprite: null,
  };
  snapshot.variants = { variant: snapshot.hull };
  snapshot.referenceSettings.values = { fluxPerCapacitor: 200, dissipationPerVent: 10 };
  snapshot.baseVersions = snapshot.records.flatMap((record) => record.baseVersions);
  return snapshot;
}
