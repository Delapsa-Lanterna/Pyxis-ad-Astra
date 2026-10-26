import type { JointEditSnapshot } from '@/shared/types';
import { fixtureSpecRecord, fixtureCsvRecord, fixtureJointSnapshot } from './joint-record';

export function weaponJointFixture(): JointEditSnapshot {
  const records = [
    fixtureSpecRecord('spec', 'weapon', {
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
    }),
    fixtureCsvRecord(
      'csv',
      'weapons',
      { id: 'chaingun' },
      {
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
      'weapon-row',
    ),
    fixtureCsvRecord(
      'description',
      'descriptions',
      { id: 'chaingun', type: 'WEAPON' },
      { id: 'chaingun', type: 'WEAPON', text1: 'Mod description', text2: 'Description role' },
      'description-row',
    ),
    fixtureSpecRecord('projectile', 'projectile', { id: 'chaingun_shot', specClass: 'projectile' }),
  ];
  return fixtureJointSnapshot('weapon', 'chaingun', records, {
    spec: 'spec',
    csv: 'csv',
    description: 'description',
    projectile: 'projectile',
  });
}
