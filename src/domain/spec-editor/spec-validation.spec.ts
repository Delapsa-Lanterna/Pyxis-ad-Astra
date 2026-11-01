import { describe, expect, it } from 'vitest';
import { specSchema } from './spec-schemas';
import { shipSpecIssues } from './ship/spec-ship-fields';
import { weaponSpecIssues } from './weapon/spec-weapon-fields';
import { projectileSpecIssues } from './projectile/spec-projectile-fields';
import { systemSpecIssues } from './system/spec-system-fields';
import { specFieldIssues } from './spec-validation';
import { createShipSpec, createSystemSpec, createSpecObject } from '@/domain/entity-write/spec-construction';
import { createWeaponSpec } from '@/domain/entity-write/spec-construction';
import { createProjectileSpec } from '@/domain/entity-write/spec-construction';
import type { JsonValue } from '@/shared/types';

describe('Spec schema validation', () => {
  it.each([
    ['requiresZeroFluxBoost', true, 'STAT_MOD', 'NONE'],
    ['minFractionToReload', 0.4, 'FAST_RELOAD', 'FAST_RELOAD'],
    ['reloadBaseAmmoAmountOnly', true, 'AMMO_RELOAD', 'AMMO_RELOAD'],
    ['allowFlameoutOnImpactWithFriendly', true, 'ENGINE_MOD', 'BURN_DRIVE'],
    ['engineActivateHiddenNozzles', false, 'STAT_MOD', 'NONE'],
    ['engineGlowMaxBlend', 0.6, 'STAT_MOD', 'NONE'],
    ['vulnerableChargeup', true, 'TELEPORTER', 'PHASE_TELEPORTER'],
    ['vulnerableChargedown', true, 'DISPLACER', 'PHASE_DISPLACER'],
    ['impactSound', 'sample-sound', 'EMP', 'EMP'],
    ['phaseChargedownVulnerabilityFraction', 0.2, 'PHASE_CLOAK', 'PHASE_CLOAK'],
  ])('validates system field %s in its execution branch', (key, value, type, aiType) => {
    const system = { ...createSystemSpec('sample'), type, aiType };
    expect(systemSpecIssues({ ...system, [key]: value })).toEqual([]);
    expect(systemSpecIssues({ ...system, [key]: [] }).map((issue) => issue.path)).toEqual([key]);
  });
  it.each([
    ['darkCore', true],
    ['darkCoreIter', 2],
    ['darkFringeIter', 3],
    ['coreWidthMult', 0.5],
  ])('validates projectile loader field %s', (key, value) => {
    const projectile = createProjectileSpec('sample', 'projectile');
    expect(projectileSpecIssues({ ...projectile, [key]: value })).toEqual([]);
    expect(projectileSpecIssues({ ...projectile, [key]: [] }).map((issue) => issue.path)).toEqual([key]);
  });
  it.each([
    'FLARE',
    'FLARE_JAMMER',
    'CANISTER_FLAK',
    'BURN_DRIVE',
    'BURN_DRIVE_TOGGLE',
    'MANEUVERING_JETS',
    'FAST_RELOAD',
    'AMMO_RELOAD',
    'FORTRESS_SHIELD',
    'DAMPER_FIELD',
    'HIGH_ENERGY_FOCUS',
    'PHASE_TELEPORTER',
    'PHASE_TELEPORTER_2',
    'PHASE_DISPLACER',
    'DRONE_LAUNCHER_PD',
    'DRONE_LAUNCHER_STANDARD',
    'WEAPON_BOOST',
    'DYNAMIC_STABILIZER',
    'LIDAR_ARRAY',
    'TEMPORAL_SHELL',
    'ACAUSAL_DISRUPTOR',
    'MOTE_ATTRACTOR',
    'ENTROPY_AMPLIFIER',
    'INTERDICTOR',
    'MINE_STRIKE',
    'DRONE_STRIKE',
    'EMP',
    'PHASE_CLOAK',
    'NONE',
    'TARGETING_FEED',
    'RESERVE_DEPLOYMENT',
    'RECALL_DEVICE',
    'CUSTOM',
  ])('accepts system AI behavior %s through save validation', (aiType) => {
    expect(systemSpecIssues({ ...createSystemSpec('sample'), aiType })).toEqual([]);
  });
  it('accepts system filters with affected weapon and damage categories through save validation', () => {
    const weaponTypes = ['BALLISTIC', 'ENERGY', 'MISSILE', 'SYSTEM'];
    for (const soundFilterType of ['LOWPASS', 'NONE']) {
      for (const damageType of ['ENERGY', 'KINETIC', 'HIGH_EXPLOSIVE', 'FRAGMENTATION']) {
        expect(systemSpecIssues({ ...createSystemSpec('sample'), soundFilterType, damageType, weaponTypes })).toEqual([]);
      }
    }
  });
  it('reports every weapon save rule from the shared asset', () => {
    const weapon = { ...createWeaponSpec('sample', 'projectile'), specClass: 'pulse', turretOffsets: [], hardpointOffsets: [] };
    expect(weaponSpecIssues(weapon).map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'spec.weapon_class_unsupported',
        'spec.weapon_turret_barrel_required',
        'spec.weapon_hardpoint_barrel_required',
      ]),
    );
  });
  it('checks untouched fields and every slot independently of view mounting', () => {
    const ship = {
      ...createShipSpec('sample'),
      spriteName: 'graphics/sample.png',
      weaponSlots: [
        { id: 'A', type: 'BUILT_IN' },
        { id: 'A', type: 'BALLISTIC' },
      ],
    };
    const issues = shipSpecIssues(ship);
    expect(issues.some((issue) => issue.code === 'spec.slot_id_duplicate' && issue.path === 'weaponSlots[1].id')).toBe(true);
    expect(issues.some((issue) => issue.path === 'weaponSlots[0].angle')).toBe(true);
    const missing: Record<string, JsonValue> = { ...ship };
    delete missing.width;
    expect(shipSpecIssues(missing).some((issue) => issue.path === 'width')).toBe(true);
  });
  it('accepts an omitted module anchor and keeps game-required ship fields checked', () => {
    const ship = createShipSpec('sample');
    ship.spriteName = 'graphics/sample.png';
    delete ship.moduleAnchor;
    expect(shipSpecIssues(ship)).toEqual([]);
    const fields = specSchema('spec-ship').sections!.find((section) => section.id === 'advanced')!.fields;
    expect(fields.filter((field) => field.key.startsWith('moduleAnchor')).every((field) => !field.required)).toBe(true);
    expect(shipSpecIssues({ ...ship, moduleAnchor: ['invalid', 0] }).some((issue) => issue.path === 'moduleAnchor[0]')).toBe(true);
    for (const type of ['BALLISTIC', 'LAUNCH_BAY']) {
      const issues = shipSpecIssues({ ...ship, weaponSlots: [{ id: 'sample-slot', type }] });
      expect(issues.map((issue) => issue.path)).toEqual([
        'weaponSlots[0].size',
        'weaponSlots[0].mount',
        'weaponSlots[0].angle',
        'weaponSlots[0].arc',
        'weaponSlots[0].locations[0]',
        'weaponSlots[0].locations[1]',
      ]);
    }
  });
  it.each([
    'BALLISTIC',
    'ENERGY',
    'MISSILE',
    'LAUNCH_BAY',
    'UNIVERSAL',
    'HYBRID',
    'SYNERGY',
    'COMPOSITE',
    'BUILT_IN',
    'DECORATIVE',
    'SYSTEM',
    'STATION_MODULE',
  ])('accepts a complete game slot of type %s', (type) => {
    const ship = {
      ...createShipSpec('sample'),
      spriteName: 'graphics/sample.png',
      weaponSlots: [{ id: 'sample-slot', size: 'LARGE', type, mount: 'HIDDEN', angle: 0, arc: 360, locations: [0, 0, 4, 2] }],
    };
    expect(shipSpecIssues(ship)).toEqual([]);
    expect(shipSpecIssues({ ...ship, weaponSlots: [{ ...ship.weaponSlots[0], type: 'INVALID' }] }).map((issue) => issue.path)).toEqual([
      'weaponSlots[0].type',
    ]);
  });
  it('requires muzzle parameters only when particles are produced', () => {
    const base = createWeaponSpec('sample', 'projectile');
    for (const particleCount of [-1, 0, 0.5]) {
      const issues = weaponSpecIssues({ ...base, muzzleFlashSpec: { particleCount } });
      expect(issues.filter((issue) => issue.path.startsWith('muzzleFlashSpec.'))).toEqual([]);
    }
    expect(
      weaponSpecIssues({ ...base, muzzleFlashSpec: { particleCount: 1 } })
        .filter((issue) => issue.path.startsWith('muzzleFlashSpec.'))
        .map((issue) => issue.path),
    ).toEqual(['length', 'spread', 'particleSizeMin', 'particleSizeRange', 'particleDuration'].map((key) => 'muzzleFlashSpec.' + key));
    expect(weaponSpecIssues({ ...base, muzzleFlashSpec: {} }).some((issue) => issue.path === 'muzzleFlashSpec.particleCount')).toBe(true);
  });
  it('requires the system AI type and inline engine styles only in their loading branches', () => {
    const system = createSystemSpec('sample');
    delete system.aiType;
    expect(systemSpecIssues(system).map((issue) => issue.path)).toContain('aiType');
    for (const id of ['spec-ship', 'spec-projectile']) {
      const inline = specSchema(id).definitions!.customEngine!.nested!.find((field) => field.key === 'styleSpec')!;
      expect(inline.requiredWhen).toEqual({ styleId: { missing: true } });
    }
    const ship = {
      ...createShipSpec('sample'),
      spriteName: 'graphics/sample.png',
      engineSlots: [{ angle: 0, width: 1, length: 1, style: 'CUSTOM', location: [0, 0] }],
    };
    expect(shipSpecIssues(ship).some((issue) => issue.path === 'engineSlots[0].styleSpec')).toBe(true);
    expect(
      shipSpecIssues({ ...ship, engineSlots: [{ ...ship.engineSlots[0], styleId: 'sample-style' }] }).some(
        (issue) => issue.path === 'engineSlots[0].styleSpec',
      ),
    ).toBe(false);
  });
  it('validates missile engines and fixed nested effects while preserving unknown content', () => {
    const missile = {
      ...createProjectileSpec('sample', 'missile'),
      sprite: 'graphics/sample.png',
      explosionSpec: { ...createSpecObject('explosionSpec'), duration: 'bad' },
      ignored: { keep: true },
    };
    const before = JSON.stringify(missile);
    expect(projectileSpecIssues(missile).some((issue) => issue.path === 'explosionSpec.duration')).toBe(true);
    expect(JSON.stringify(missile)).toBe(before);
    expect(systemSpecIssues({ ...createSystemSpec('sample'), shipAlpha: 'bad' }).some((issue) => issue.path === 'shipAlpha')).toBe(true);
  });
  it('resolves shared definitions and keeps all asset references out of the rendered definitions', () => {
    for (const id of ['spec-ship', 'spec-weapon', 'spec-projectile', 'spec-system'])
      expect(JSON.stringify(specSchema(id))).not.toContain('"ref":');
    const custom = specSchema('spec-ship').definitions!.customEngine!.nested!.find((field) => field.key === 'styleSpec')!;
    expect(custom.nested).toHaveLength(23);
    expect(custom.partial).toBe(false);
  });
  it('checks types, limits, required values and open-object entries with one traversal', () => {
    const field = specSchema('spec-system')
      .sections!.find((section) => section.id === 'basic')!
      .fields.find((field) => field.key === 'type')!;
    expect(specFieldIssues(field, 'UNKNOWN')).toHaveLength(1);
    expect(specFieldIssues(field, 'STAT_MOD')).toEqual([]);
    const color = specSchema('spec-system')
      .sections!.find((section) => section.id === 'engine')!
      .fields.find((field) => field.key === 'engineGlowColor')!;
    expect(specFieldIssues(color, [0, 0, 0, 300])).toHaveLength(1);
    const texture = specSchema('spec-weapon')
      .sections!.find((section) => section.id === 'beam')!
      .fields.find((field) => field.key === 'textureType')!;
    expect(specFieldIssues(texture, 7)).toHaveLength(1);
    expect(specFieldIssues(texture, ['outer', 'core'])).toEqual([]);
  });
});
