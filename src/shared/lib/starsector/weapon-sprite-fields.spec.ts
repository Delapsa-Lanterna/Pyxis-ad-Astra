import { describe, expect, it } from 'vitest';
import {
  HARDPOINT_WEAPON_SPRITE_FIELDS,
  TURRET_WEAPON_SPRITE_FIELDS,
  WEAPON_SPRITE_DRAW_ORDER,
  WEAPON_SPRITE_FIELDS,
  WEAPON_SPRITE_ORIGIN_RATIO,
  weaponAnglesKey,
  weaponBarrelOffsetsFor,
  weaponOffsetsKey,
  weaponSpriteDrawOrder,
} from '@/shared/lib/starsector/weapon-sprite-fields';

describe('weapon sprite field registry', () => {
  it.each(['turret', 'hardpoint'] as const)('orders %s layers using the barrel rendering hint', (mode) => {
    expect(weaponSpriteDrawOrder({ specClass: 'projectile', visualRecoil: 1 }, mode)).toEqual([
      mode + 'UnderSprite',
      mode + 'Sprite',
      mode + 'GunSprite',
    ]);
    expect(weaponSpriteDrawOrder({ specClass: 'projectile', visualRecoil: 1, renderHints: ['RENDER_BARREL_BELOW'] }, mode)).toEqual([
      mode + 'UnderSprite',
      mode + 'GunSprite',
      mode + 'Sprite',
    ]);
  });
  it.each(['beam', 'pulse', 'projectile'])('uses the %s body and under layer at zero recoil', (specClass) => {
    expect(weaponSpriteDrawOrder({ specClass, visualRecoil: 0, renderHints: ['RENDER_BARREL_BELOW'] }, 'turret')).toEqual([
      'turretUnderSprite',
      'turretSprite',
    ]);
  });
  it('maps view modes to the canonical offset/angle keys', () => {
    expect(weaponOffsetsKey('turret')).toBe('turretOffsets');
    expect(weaponOffsetsKey('hardpoint')).toBe('hardpointOffsets');
    expect(weaponAnglesKey('turret')).toBe('turretAngleOffsets');
    expect(weaponAnglesKey('hardpoint')).toBe('hardpointAngleOffsets');
  });

  it('keeps draw order within the declared sprite fields', () => {
    for (const field of [...WEAPON_SPRITE_DRAW_ORDER.turret, ...WEAPON_SPRITE_DRAW_ORDER.hardpoint]) {
      expect(WEAPON_SPRITE_FIELDS).toContain(field);
    }
    expect([...TURRET_WEAPON_SPRITE_FIELDS, ...HARDPOINT_WEAPON_SPRITE_FIELDS]).toEqual(WEAPON_SPRITE_FIELDS);
  });

  it('reads barrel offsets as a read-only projection with display fallback', () => {
    expect(weaponBarrelOffsetsFor({ turretOffsets: [1, 2, 3, 4] }, 'turret')).toEqual([1, 2, 3, 4]);
    expect(weaponBarrelOffsetsFor({}, 'hardpoint')).toEqual([10, 0]);
    expect(weaponBarrelOffsetsFor({ hardpointOffsets: [] }, 'hardpoint')).toEqual([10, 0]);
    expect(weaponBarrelOffsetsFor({ hardpointOffsets: [5] }, 'hardpoint')).toEqual([10, 0]);
    expect(weaponBarrelOffsetsFor({ turretOffsets: 'bad' }, 'turret')).toEqual([10, 0]);
  });

  it('anchors the shared sprite origin ratios', () => {
    expect(WEAPON_SPRITE_ORIGIN_RATIO.turret).toEqual({ x: 0.5, y: 0.5 });
    expect(WEAPON_SPRITE_ORIGIN_RATIO.hardpoint).toEqual({ x: 0.5, y: 0.75 });
  });
});
