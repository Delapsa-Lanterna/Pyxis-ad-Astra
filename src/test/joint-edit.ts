import type { JointEditRecord, JointEditSnapshot, JointValue, JsonValue } from '@/shared/types';
import { entityTargetFixture } from './entity-target';

export function shipJointFixture(): JointEditSnapshot {
  const target = entityTargetFixture('ship', 'lasher');
  const spec: JointEditRecord = {
    key: 'spec',
    target: { kind: 'spec', target },
    source: target.write,
    sourceVersion: { path: target.write.path, fingerprint: 'spec-v' },
    value: {
      state: 'present',
      value: {
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
      },
    },
    baseVersions: [{ path: target.write.path, fingerprint: 'spec-v' }],
    resourceRefs: {},
    referencedBy: ['Ship:lasher'],
  };
  function csv(
    key: string,
    table: 'ships' | 'descriptions' | 'shipSystems' | 'weapons' | 'hullmods',
    identity: Record<string, string>,
    data: Record<string, JsonValue>,
  ): JointEditRecord {
    const path = `M:/mod/${table}.csv`;
    return {
      key,
      target: { kind: 'csv', table, rowKey: key, identity, write: { source: 'mod', root: 'M:/mod', relPath: `${table}.csv`, path } },
      source: { source: 'mod', root: 'M:/mod', relPath: `${table}.csv`, path },
      sourceVersion: { path, fingerprint: key },
      value: { state: 'present', value: data },
      baseVersions: [{ path, fingerprint: key }],
      resourceRefs: {},
      referencedBy: ['lasher'],
    };
  }
  const systemTarget = entityTargetFixture('system', 'ammofeed');
  const system: JointEditRecord = {
    ...spec,
    key: 'system',
    target: { kind: 'spec', target: systemTarget },
    source: systemTarget.write,
    value: { state: 'present', value: { id: 'ammofeed' } },
  };
  const records = [
    spec,
    csv(
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
    csv(
      'description',
      'descriptions',
      { id: 'lasher', type: 'SHIP' },
      { id: 'lasher', type: 'SHIP', text1: 'Mod original description', text2: 'second' },
    ),
    system,
    csv('system-csv', 'shipSystems', { id: 'ammofeed' }, { id: 'ammofeed', name: 'Accelerated Ammo Feeder' }),
    csv(
      'system-description',
      'descriptions',
      { id: 'ammofeed', type: 'SHIP_SYSTEM' },
      { id: 'ammofeed', type: 'SHIP_SYSTEM', text3: 'Brief ballistic boost' },
    ),
    csv('weapon', 'weapons', { id: 'weapon' }, { id: 'weapon', name: 'Weapon name' }),
    csv(
      'mod',
      'hullmods',
      { id: 'rangefinder' },
      { id: 'rangefinder', name: 'Ballistic Rangefinder', desc: '<tooltip created in script>', short: 'Base range bonus' },
    ),
  ];
  return {
    root: { sessionId: 's', modRoot: 'M:/mod', kind: 'ship', id: 'lasher' },
    bindings: { spec: 'spec', csv: 'csv', description: 'description', system: 'system' },
    referenceSettings: {
      values: { baseSensorFrigate: 30 },
      versions: [{ path: 'G:/core/data/config/settings.json', fingerprint: 'settings' }],
    },
    records,
    baseVersions: records.flatMap((record) => record.baseVersions),
  };
}

export function jointFixtureValues(snapshot: JointEditSnapshot): Record<string, JointValue> {
  return Object.fromEntries(
    snapshot.records
      .filter((record) => ['spec', 'csv', 'description'].includes(record.key))
      .map((record) => [record.key, structuredClone(record.value)]),
  );
}
