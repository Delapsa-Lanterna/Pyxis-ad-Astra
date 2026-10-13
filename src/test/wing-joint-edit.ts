import type { JointEditRecord, JointEditSnapshot } from '@/shared/types';
import { shipJointFixture } from './joint-edit';
import { entityTargetFixture } from './entity-target';

export function wingJointFixture(): JointEditSnapshot {
  const snapshot = shipJointFixture();
  const hull = snapshot.records[0]!;
  hull.target = { kind: 'spec', target: entityTargetFixture('ship', 'sarissa') };
  hull.source = hull.target.target.write;
  hull.value = {
    state: 'present',
    value: {
      hullId: 'sarissa',
      hullSize: 'FIGHTER',
      spriteName: 'graphics/ships/fighters/sarissa_lowtech.png',
      width: 34,
      height: 35,
      weaponSlots: [
        { id: 'WS000', type: 'BALLISTIC', size: 'SMALL' },
        { id: 'WS001', type: 'BALLISTIC', size: 'SMALL' },
      ],
    },
  };
  const csv = snapshot.records[1]!;
  csv.key = 'hull-csv';
  csv.target = {
    kind: 'csv',
    table: 'ships',
    rowKey: 'hull-row',
    identity: { id: 'sarissa' },
    write: { source: 'mod', root: 'M:/mod', relPath: 'data/hulls/ship_data.csv', path: 'M:/mod/data/hulls/ship_data.csv' },
  };
  csv.value = {
    state: 'present',
    value: {
      id: 'sarissa',
      name: 'Sarissa',
      'tech/manufacturer': 'Low Tech',
      'system id': 'canister_flak',
      'min crew': '3',
      hitpoints: '750',
      'armor rating': '200',
      'max speed': '140',
      'shield type': 'NONE',
    },
  };
  const description = snapshot.records[2]!;
  if (description.target.kind === 'csv') description.target.identity = { id: 'sarissa', type: 'SHIP' };
  description.value = { state: 'present', value: { id: 'sarissa', type: 'SHIP', text1: 'An old but reliable defensive fighter model.' } };
  const system = snapshot.records.find((record) => record.key === 'system')!;
  system.target = { kind: 'spec', target: entityTargetFixture('system', 'canister_flak') };
  system.value = { state: 'present', value: { id: 'canister_flak' } };
  const systemCsv = snapshot.records.find((record) => record.key === 'system-csv')!;
  if (systemCsv.target.kind === 'csv') systemCsv.target.identity = { id: 'canister_flak' };
  systemCsv.value = { state: 'present', value: { id: 'canister_flak', name: 'Canister Flak' } };
  const systemDescription = snapshot.records.find((record) => record.key === 'system-description')!;
  if (systemDescription.target.kind === 'csv') systemDescription.target.identity = { id: 'canister_flak', type: 'SHIP_SYSTEM' };
  systemDescription.value = {
    state: 'present',
    value: {
      id: 'canister_flak',
      type: 'SHIP_SYSTEM',
      text3: 'Each canister deals 200 High Explosive damage.',
      text4: '200 High Explosive',
    },
  };
  const weapon = snapshot.records.find((record) => record.key === 'weapon')!;
  if (weapon.target.kind === 'csv') weapon.target.identity = { id: 'lightac' };
  weapon.value = { state: 'present', value: { id: 'lightac', name: 'Light Autocannon' } };
  const target = entityTargetFixture('variant', 'sarissa_Fighter');
  const variant: JointEditRecord = {
    key: 'variant',
    target: { kind: 'spec', target },
    source: target.write,
    sourceVersion: { path: target.write.path, fingerprint: 'variant' },
    baseVersions: [{ path: target.write.path, fingerprint: 'variant' }],
    resourceRefs: {},
    referencedBy: ['Wing:sarissa_wing'],
    value: {
      state: 'present',
      value: {
        variantId: 'sarissa_Fighter',
        hullId: 'sarissa',
        displayName: 'Support Fighter',
        weaponGroups: [{ mode: 'ALTERNATING', weapons: { WS000: 'lightac', WS001: 'lightac' } }],
        unknown: 'retained',
      },
    },
  };
  const wing: JointEditRecord = {
    ...csv,
    key: 'wing',
    target: {
      kind: 'csv',
      table: 'wings',
      rowKey: 'wing-row',
      identity: { id: 'sarissa_wing' },
      write: { source: 'mod', root: 'M:/mod', relPath: 'data/hulls/wing_data.csv', path: 'M:/mod/data/hulls/wing_data.csv' },
    },
    value: {
      state: 'present',
      value: {
        id: 'sarissa_wing',
        variant: 'sarissa_Fighter',
        role: 'SUPPORT',
        'role desc': 'Support',
        'op cost': '12',
        range: '0',
        num: '3',
        formation: 'CLAW',
        refit: '10',
      },
    },
  };
  snapshot.root = { sessionId: 's', modRoot: 'M:/mod', kind: 'wing', id: 'sarissa_wing' };
  snapshot.bindings = {
    csv: 'wing',
    variant: 'variant',
    hull: 'spec',
    spec: 'spec',
    hullCsv: 'hull-csv',
    description: 'description',
    system: 'system',
  };
  snapshot.records = [...snapshot.records.filter((record) => record.key !== 'mod'), variant, wing];
  snapshot.hull = {
    slots: [],
    builtInWeapons: {},
    builtInMods: [],
    builtInWings: [],
    modules: [],
    variantKey: 'variant',
    hullKey: 'spec',
    displayBindings: { csv: 'hull-csv', description: 'description' },
    skinKeys: [],
    fields: Object.fromEntries(
      [
        'name',
        'tech/manufacturer',
        'min crew',
        'hitpoints',
        'armor rating',
        'max speed',
        'system id',
        'shield type',
        'max flux',
        'defense id',
        'shield arc',
        'shield efficiency',
      ].map((path) => [path, { recordKey: 'hull-csv', path }]),
    ),
    weapons: { WS000: 'lightac', WS001: 'lightac' },
    sprite: null,
  };
  const paths = {
    ships: 'data/hulls/ship_data.csv',
    wings: 'data/hulls/wing_data.csv',
    descriptions: 'data/strings/descriptions.csv',
    weapons: 'data/weapons/weapon_data.csv',
    shipSystems: 'data/shipsystems/ship_systems.csv',
  };
  for (const record of snapshot.records) {
    if (record.target.kind === 'csv') {
      const relPath = paths[record.target.table as keyof typeof paths];
      record.target.write = { source: 'mod', root: 'M:/mod', relPath, path: 'M:/mod/' + relPath };
    }
    const location = record.target.kind === 'spec' ? record.target.target.write : record.target.write;
    record.source = location;
    record.sourceVersion = { path: location.path, fingerprint: record.target.kind === 'csv' ? record.target.table : record.key };
    record.baseVersions = [record.sourceVersion];
  }
  snapshot.baseVersions = [
    ...new Map(snapshot.records.flatMap((record) => record.baseVersions).map((version) => [version.path, version])).values(),
  ];
  return snapshot;
}
