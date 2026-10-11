import type { JointEditRecord, JointEditSnapshot } from '@/shared/types';
import { entityTargetFixture } from './entity-target';

export function weaponJointFixture(): JointEditSnapshot {
  const target = entityTargetFixture('weapon', 'chaingun');
  const spec: JointEditRecord = {
    key: 'spec',
    target: { kind: 'spec', target },
    source: target.write,
    sourceVersion: { path: target.write.path, fingerprint: 'weapon' },
    value: {
      state: 'present',
      value: {
        id: 'chaingun',
        specClass: 'projectile',
        type: 'BALLISTIC',
        size: 'MEDIUM',
        barrelMode: 'ALTERNATING',
        turretOffsets: [10, 0],
        projectileSpecId: 'chaingun_shot',
        turretSprite: 'graphics/weapons/rotary/rotary_cannon_turret_base00.png',
        numFrames: 4,
        unknown: { retained: true },
      },
    },
    baseVersions: [{ path: target.write.path, fingerprint: 'weapon' }],
    resourceRefs: {},
    referencedBy: ['Weapon:chaingun'],
  };
  const csv: JointEditRecord = {
    key: 'csv',
    target: {
      kind: 'csv',
      table: 'weapons',
      rowKey: 'weapon-row',
      identity: { id: 'chaingun' },
      write: { source: 'mod', root: 'M:/mod', relPath: 'data/weapons/weapon_data.csv', path: 'M:/mod/data/weapons/weapon_data.csv' },
    },
    source: null,
    sourceVersion: null,
    baseVersions: [],
    resourceRefs: {},
    referencedBy: ['Weapon:chaingun'],
    value: {
      state: 'present',
      value: {
        id: 'chaingun',
        name: 'Assault Chaingun',
        'tech/manufacturer': 'Low Tech',
        type: 'HIGH_EXPLOSIVE',
        OPs: '10',
        range: '450',
        'damage/shot': '75',
        chargedown: '0.15',
        'energy/shot': '60',
        'max spread': '20',
        'turn rate': '30',
        primaryRoleStr: 'Anti Armor',
      },
    },
  };
  const description: JointEditRecord = {
    ...csv,
    key: 'description',
    target: {
      ...csv.target,
      kind: 'csv',
      table: 'descriptions',
      rowKey: 'description-row',
      identity: { id: 'chaingun', type: 'WEAPON' },
      write: { source: 'mod', root: 'M:/mod', relPath: 'data/strings/descriptions.csv', path: 'M:/mod/data/strings/descriptions.csv' },
    },
    value: { state: 'present', value: { id: 'chaingun', type: 'WEAPON', text1: 'Mod description', text2: 'Description role' } },
  };
  const projectileTarget = entityTargetFixture('projectile', 'chaingun_shot');
  const projectile: JointEditRecord = {
    ...spec,
    key: 'projectile',
    target: { kind: 'spec', target: projectileTarget },
    source: projectileTarget.write,
    value: { state: 'present', value: { id: 'chaingun_shot', specClass: 'projectile' } },
  };
  const records = [spec, csv, description, projectile];
  return {
    root: { sessionId: 's', modRoot: 'M:/mod', kind: 'weapon', id: 'chaingun' },
    bindings: { spec: 'spec', csv: 'csv', description: 'description', projectile: 'projectile' },
    referenceSettings: { values: {}, versions: [] },
    records,
    baseVersions: records.flatMap((record) => record.baseVersions),
  };
}
