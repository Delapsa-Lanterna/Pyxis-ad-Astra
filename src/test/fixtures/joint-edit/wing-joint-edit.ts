import type { JointEditSnapshot } from '@/shared/types';
import { fixtureSpecRecord, fixtureCsvRecord, fixtureJointSnapshot } from './joint-record';

export function wingJointFixture(): JointEditSnapshot {
  const records = [
    fixtureSpecRecord('spec', 'ship', {
      hullId: 'sarissa',
      hullSize: 'FIGHTER',
      spriteName: 'graphics/ships/fighters/sarissa_lowtech.png',
      width: 34,
      height: 35,
      weaponSlots: [
        { id: 'WS000', type: 'BALLISTIC', size: 'SMALL' },
        { id: 'WS001', type: 'BALLISTIC', size: 'SMALL' },
      ],
    }),
    fixtureCsvRecord(
      'hull-csv',
      'ships',
      { id: 'sarissa' },
      {
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
      'hull-row',
    ),
    fixtureCsvRecord(
      'description',
      'descriptions',
      { id: 'sarissa', type: 'SHIP' },
      { id: 'sarissa', type: 'SHIP', text1: 'An old but reliable defensive fighter model.' },
    ),
    fixtureSpecRecord('system', 'system', { id: 'canister_flak' }),
    fixtureCsvRecord('system-csv', 'shipSystems', { id: 'canister_flak' }, { id: 'canister_flak', name: 'Canister Flak' }),
    fixtureCsvRecord(
      'system-description',
      'descriptions',
      { id: 'canister_flak', type: 'SHIP_SYSTEM' },
      {
        id: 'canister_flak',
        type: 'SHIP_SYSTEM',
        text3: 'Each canister deals 200 High Explosive damage.',
        text4: '200 High Explosive',
      },
    ),
    fixtureCsvRecord('weapon', 'weapons', { id: 'lightac' }, { id: 'lightac', name: 'Light Autocannon' }),
    fixtureSpecRecord('variant', 'variant', {
      variantId: 'sarissa_Fighter',
      hullId: 'sarissa',
      displayName: 'Support Fighter',
      weaponGroups: [{ mode: 'ALTERNATING', weapons: { WS000: 'lightac', WS001: 'lightac' } }],
      unknown: 'retained',
    }),
    fixtureCsvRecord(
      'wing',
      'wings',
      { id: 'sarissa_wing' },
      {
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
      'wing-row',
    ),
  ];
  const snapshot = fixtureJointSnapshot('wing', 'sarissa_wing', records, {
    csv: 'wing',
    variant: 'variant',
    hull: 'spec',
    spec: 'spec',
    hullCsv: 'hull-csv',
    description: 'description',
    system: 'system',
  });
  snapshot.hull = {
    hints: [],
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
  return snapshot;
}
