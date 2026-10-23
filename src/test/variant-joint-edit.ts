import type { JointEditSnapshot } from '@/shared/types';
import { fixtureSpecRecord, fixtureCsvRecord, fixtureJointSnapshot } from './joint-record';
import { weaponJointFixture } from './weapon-joint-edit';

export function variantJointFixture(): JointEditSnapshot {
  const hullData = {
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
  };
  const records = [
    fixtureSpecRecord('spec', 'ship', hullData),
    fixtureCsvRecord(
      'csv',
      'ships',
      { id: 'aurora' },
      {
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
    ),
    fixtureCsvRecord(
      'description',
      'descriptions',
      { id: 'aurora', type: 'SHIP' },
      { id: 'aurora', type: 'SHIP', text1: 'Aurora sample description' },
    ),
    fixtureCsvRecord(
      'mod',
      'hullmods',
      { id: 'rangefinder' },
      {
        id: 'rangefinder',
        name: 'Safety Overrides',
        'tech/manufacturer': 'High Tech',
        cost_cruiser: '45',
        desc: 'Base configuration sample',
        uiTags: 'Weapons, Flux',
      },
    ),
    fixtureSpecRecord('variant', 'variant', {
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
    }),
    fixtureCsvRecord(
      'wing',
      'wings',
      { id: 'sarissa_wing' },
      {
        id: 'sarissa_wing',
        variant: 'sarissa_Fighter',
        'role desc': 'Support',
        'op cost': '12',
        num: '3',
        formation: 'CLAW',
        refit: '10',
      },
      'wing-row',
    ),
    ...weaponJointFixture().records.map((record) => ({ ...record, key: 'weapon-' + record.key })),
  ];
  const snapshot = fixtureJointSnapshot('variant', 'aurora_refit', records, { spec: 'variant', variant: 'variant' });
  snapshot.hull = {
    variantKey: 'variant',
    hullKey: 'spec',
    skinKeys: [],
    hints: [],
    slots: hullData.weaponSlots,
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
    displayBindings: { csv: 'csv', description: 'description' },
    builtInWeapons: { WS1: 'chaingun' },
    builtInMods: [],
    builtInWings: [],
    modules: [],
    sprite: null,
  };
  snapshot.variants = { variant: snapshot.hull };
  snapshot.referenceSettings.values = { fluxPerCapacitor: 200, dissipationPerVent: 10 };
  return snapshot;
}
