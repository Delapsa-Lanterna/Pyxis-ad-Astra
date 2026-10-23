import type { JointEditSnapshot } from '@/shared/types';
import { fixtureSpecRecord, fixtureCsvRecord, fixtureJointSnapshot } from './joint-record';

export function shipJointFixture(): JointEditSnapshot {
  const spec = fixtureSpecRecord('spec', 'ship', {
    hullId: 'lasher',
    hullSize: 'FRIGATE',
    spriteName: 'graphics/lasher.png',
    weaponSlots: [
      { type: 'MISSILE', size: 'SMALL' },
      { type: 'MISSILE', size: 'SMALL' },
      ...Array.from({ length: 5 }, () => ({ type: 'BALLISTIC', size: 'SMALL' })),
    ],
    builtInMods: ['rangefinder'],
    builtInWeapons: { WS1: 'weapon', WS2: 'weapon' },
    custom: 'retained',
  });
  const system = fixtureSpecRecord('system', 'system', { id: 'ammofeed' });
  const records = [
    spec,
    fixtureCsvRecord(
      'csv',
      'ships',
      { id: 'lasher' },
      {
        id: 'lasher',
        name: 'Lasher',
        designation: 'Frigate',
        'tech/manufacturer': 'Low Tech',
        'system id': 'ammofeed',
        'fleet pts': '5',
        hitpoints: '1750',
        'armor rating': '300',
        'max flux': '2100',
        'flux dissipation': '140',
        'ordnance points': '55',
        'max speed': '120',
        'shield type': 'FRONT',
        'shield arc': '210',
        'shield upkeep': '0.4',
        'shield efficiency': '1',
        'min crew': '25',
        'max crew': '50',
        cargo: '40',
        fuel: '25',
        'fuel/ly': '1',
        'max burn': '10',
        'CR to deploy': '10',
        'cr %/day': '8',
        'peak CR sec': '240',
        'CR loss/sec': '0.25',
        'supplies/rec': '4',
        'supplies/mo': '4',
      },
    ),
    fixtureCsvRecord(
      'description',
      'descriptions',
      { id: 'lasher', type: 'SHIP' },
      { id: 'lasher', type: 'SHIP', text1: 'Mod original description', text2: 'second' },
    ),
    system,
    fixtureCsvRecord('system-csv', 'shipSystems', { id: 'ammofeed' }, { id: 'ammofeed', name: 'Accelerated Ammo Feeder' }),
    fixtureCsvRecord(
      'system-description',
      'descriptions',
      { id: 'ammofeed', type: 'SHIP_SYSTEM' },
      { id: 'ammofeed', type: 'SHIP_SYSTEM', text3: 'Brief ballistic boost' },
    ),
    fixtureCsvRecord('weapon', 'weapons', { id: 'weapon' }, { id: 'weapon', name: 'Weapon name' }),
    fixtureCsvRecord(
      'mod',
      'hullmods',
      { id: 'rangefinder' },
      { id: 'rangefinder', name: 'Ballistic Rangefinder', desc: '<tooltip created in script>', short: 'Base range bonus' },
    ),
  ];
  const snapshot = fixtureJointSnapshot('ship', 'lasher', records, {
    spec: 'spec',
    csv: 'csv',
    description: 'description',
    system: 'system',
  });
  snapshot.referenceSettings = {
    resources: {},
    values: { baseSensorFrigate: 30 },
    versions: [{ path: 'G:/core/data/config/settings.json', fingerprint: 'settings' }],
  };
  return snapshot;
}
