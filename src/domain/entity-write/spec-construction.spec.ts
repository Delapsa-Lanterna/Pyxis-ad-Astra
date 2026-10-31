import { describe, expect, it } from 'vitest';
import {
  createDefaultVariant,
  createDefaultSkin,
  createShipSpec,
  createSkillSpec,
  createSystemSpec,
} from '@/domain/entity-write/spec-construction';
import { changeWeaponSpecClass, createWeaponSpec } from '@/domain/entity-write/spec-construction';
import { changeProjectileSpecClass, createProjectileSpec } from '@/domain/entity-write/spec-construction';
import defaults from '../../../schemas/spec-defaults.json';
import type { RowData } from '@/shared/types';

describe('shared game spec construction', () => {
  it('constructs all seven branches from the shared defaults with explicit identity', () => {
    expect(defaults.$schema).toBe('pyxis-ad-astra/spec-defaults/v1');
    expect(createShipSpec('ship', 'Ship')).toEqual({ ...defaults.ship, hullId: 'ship', hullName: 'Ship' });
    for (const specClass of ['projectile', 'beam'] as const)
      expect(createWeaponSpec('weapon', specClass)).toEqual({ ...defaults.weapon[specClass], id: 'weapon' });
    for (const specClass of ['projectile', 'missile'] as const)
      expect(createProjectileSpec('shot', specClass)).toEqual({ ...defaults.projectile[specClass], id: 'shot' });
    expect(createSystemSpec('system')).toEqual({ ...defaults.system, id: 'system' });
    expect(createSkillSpec('skill')).toEqual({ ...defaults.skill, id: 'skill' });
  });

  it('keeps loader-required fields typed and references editable', () => {
    expect(createShipSpec('s')).toMatchObject({
      center: [50, 75],
      width: 100,
      height: 150,
      spriteName: '',
      hullSize: 'FRIGATE',
      shieldCenter: [0, 0],
      shieldRadius: 60,
    });
    expect(createWeaponSpec('w', 'beam')).toMatchObject({
      textureType: 'SMOOTH',
      size: 'SMALL',
      type: 'BALLISTIC',
      turretAngleOffsets: [0],
    });
    expect(createWeaponSpec('w', 'projectile')).toMatchObject({
      barrelMode: 'ALTERNATING',
      animationType: 'MUZZLE_FLASH',
      projectileSpecId: '',
    });
    expect(createProjectileSpec('p')).toMatchObject({
      spawnType: 'BALLISTIC',
      collisionClass: 'PROJECTILE_NO_FF',
      collisionClassByFighter: 'PROJECTILE_FIGHTER',
      width: 3.5,
      fadeTime: 0.3,
    });
    expect(createProjectileSpec('m', 'missile')).toMatchObject({
      missileType: 'MISSILE',
      sprite: '',
      size: [10, 20],
      center: [5, 10],
      engineSpec: { turnAcc: 0, turnRate: 0, acc: 0, dec: 0 },
    });
    expect(createSkillSpec('s')).toMatchObject({ governingAptitude: '', effectGroups: [] });
    expect(createSystemSpec('s')).toMatchObject({ type: 'STAT_MOD', aiType: 'NONE' });
  });

  it('creates independently editable nested structures', () => {
    const first = createShipSpec('a');
    (first.center as number[])[0] = 99;
    (first.builtInWeapons as RowData)._slot = 'weapon';
    expect(createShipSpec('b').center).toEqual([50, 75]);
    expect(createShipSpec('b').builtInWeapons).toEqual({});
    const missile = createProjectileSpec('a', 'missile');
    (missile.engineSpec as RowData).acc = 100;
    expect(createProjectileSpec('b', 'missile').engineSpec).toMatchObject({ acc: 0 });
  });

  it('preserves business content while completing the target branch', () => {
    const content: RowData = {
      id: 'w',
      specClass: 'pulse',
      type: 'ENERGY',
      _rowKey: 'business',
      turretOffsets: [7, 8],
      nested: { _slot: 'keep' },
    };
    const beam = changeWeaponSpecClass(content, 'beam');
    expect(beam).toMatchObject({
      id: 'w',
      specClass: 'beam',
      type: 'ENERGY',
      turretOffsets: [7, 8],
      textureType: 'SMOOTH',
      _rowKey: 'business',
      nested: { _slot: 'keep' },
    });
    const projectile = changeWeaponSpecClass(beam, 'projectile');
    expect(projectile).toMatchObject({ textureType: 'SMOOTH', barrelMode: 'ALTERNATING', projectileSpecId: '' });
    expect(content.specClass).toBe('pulse');
    const missile = changeProjectileSpecClass({ id: 'm', custom: [{ _field: 2 }], engineSpec: { acc: 50 } }, 'missile');
    expect(missile.engineSpec).toEqual({ acc: 50, turnAcc: 0, turnRate: 0, dec: 0 });
    expect(missile.custom).toEqual([{ _field: 2 }]);
  });
});

describe('JSON entity defaults', () => {
  it('creates independent Skin defaults without description identity fields', () => {
    const skin = createDefaultSkin('base', 'skin');
    expect(skin).toMatchObject({ skinHullId: 'skin', baseHullId: 'base', hullName: 'skin' });
    expect(Object.hasOwn(skin, 'descriptionId')).toBe(false);
    expect(Object.hasOwn(skin, 'descriptionPrefix')).toBe(false);
    skin.builtInMods = ['changed'];
    expect(createDefaultSkin('base', 'next').builtInMods).toEqual([]);
  });

  it('creates independent Variant collection defaults', () => {
    const variant = createDefaultVariant('hull', 'variant');
    expect(variant).toMatchObject({ variantId: 'variant', hullId: 'hull', weaponGroups: [], wings: [] });
    variant.weaponGroups = [{}];
    expect(createDefaultVariant('hull', 'next').weaponGroups).toEqual([]);
  });
});
