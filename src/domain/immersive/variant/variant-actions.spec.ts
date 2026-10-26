import { describe, it, expect } from 'vitest';
import {
  equipVariantWeapon,
  equipVariantWing,
  setVariantHullmod,
  moveVariantWeapon,
  weaponSlotCompatibility,
  stripVariant,
  variantBranchKeys,
  variantWeaponGroups,
  isSystemWeapon,
} from './variant-actions';
import { setVariantModule } from '@/domain/json-editor/json-variant-modules';
import { variantJointFixture } from '@/test/fixtures/joint-edit/variant-joint-edit';
import { jointObject } from '@/domain/joint-edit';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import type { RowData, JointValue, JointEditRecord } from '@/shared/types';
describe('variant equipment actions', () => {
  it.each([
    [{ hints: 'SYSTEM' }, {}, true],
    [{ hints: ' PD, SYSTEM , ANTI_FTR ' }, {}, true],
    [{ hints: 'SYSTEMATIC, PD' }, {}, false],
    [{ hints: '' }, { aiHints: ['SYSTEM'] }, true],
    [{}, { aiHints: ['PD'] }, false],
  ])('resolves system weapon hints from CSV and specifications', (csv, spec, expected) => {
    expect(isSystemWeapon(csv, spec)).toBe(expected);
  });
  it('strips all editable equipment while preserving built-ins, empty bay indices and unknown fields', () => {
    const snapshot = variantJointFixture(),
      hull = snapshot.variants.variant!;
    hull.builtInWeapons = { B: 'builtin-gun' };
    hull.builtInMods = ['builtin'];
    hull.builtInWings = ['builtin-wing'];
    const data: RowData = {
      variantId: 'root',
      hullId: 'hull',
      displayName: 'Original',
      modules: [{ M: 'module' }],
      unknown: { value: '007' },
      weaponGroups: [
        { mode: 'LINKED', autofire: true, weapons: { A: 'gun', B: 'builtin-gun' }, custom: 'keep' },
        { mode: 'ALTERNATING', weapons: { C: 'gun' } },
      ],
      wings: ['builtin-wing', 'wing', ''],
      hullMods: ['builtin', 'ordinary', 'permanent', 's'],
      permaMods: ['permanent', 's'],
      sMods: ['s'],
      sModdedBuiltIns: ['builtin'],
      fluxVents: 5,
      fluxCapacitors: 7,
    };
    expect(stripVariant(data, hull)).toEqual({
      ...data,
      weaponGroups: [{ ...variantWeaponGroups(data)[0], weapons: { B: 'builtin-gun' } }],
      wings: ['builtin-wing', '', ''],
      hullMods: ['builtin'],
      permaMods: [],
      sMods: [],
      fluxVents: 0,
      fluxCapacitors: 0,
    });
    expect(variantWeaponGroups(data)[0]!.weapons).toEqual({ A: 'gun', B: 'builtin-gun' });
    const stripped = stripVariant(data, hull);
    expect(stripVariant(stripped, hull)).toEqual(stripped);
  });
  it('traverses the current module branch once per physical record and keeps parent scopes distinct', () => {
    const snapshot = variantJointFixture(),
      root = snapshot.records.find((record) => record.key === 'variant')!;
    const module: JointEditRecord = {
      ...structuredClone(root),
      key: 'module',
      target: { kind: 'spec', target: entityTargetFixture('variant', 'module') },
      value: { state: 'present', value: { variantId: 'module', hullId: 'aurora', modules: { back: 'aurora_refit' } } },
    };
    snapshot.records.push(module);
    const values: Record<string, JointValue> = {
      variant: { state: 'present', value: { ...jointObject(root.value), modules: [{ M: 'module' }, { N: 'module' }] } },
      module: module.value,
    };
    expect(variantBranchKeys(snapshot, values, 'variant')).toEqual(['variant', 'module']);
    module.value = { state: 'present', value: { ...jointObject(module.value), modules: {} } };
    expect(variantBranchKeys(snapshot, { ...values, module: module.value }, 'module')).toEqual(['module']);
    expect(stripVariant({ variantId: 'empty', hullId: 'aurora' }, snapshot.variants.variant!)).toEqual({
      variantId: 'empty',
      hullId: 'aurora',
    });
  });
  it('replaces weapons in their group, removes one slot and preserves unknown values', () => {
    const data = {
      weaponGroups: [{ mode: 'ALTERNATING', autofire: true, weapons: { A: 'old', B: 'other' }, custom: '007' }],
      unknown: true,
    };
    expect(equipVariantWeapon(data, 'A', 'new')).toEqual({
      ...data,
      weaponGroups: [{ ...data.weaponGroups[0], weapons: { A: 'new', B: 'other' } }],
    });
    expect(equipVariantWeapon(data, 'A', '').weaponGroups).toEqual([{ ...data.weaponGroups[0], weapons: { B: 'other' } }]);
    expect(data.weaponGroups[0]!.weapons.A).toBe('old');
    expect(equipVariantWeapon({}, 'X', 'gun').weaponGroups).toEqual([{ mode: 'LINKED', autofire: false, weapons: { X: 'gun' } }]);
  });
  it('moves exactly one slot between existing groups', () => {
    expect(
      moveVariantWeapon(
        {
          weaponGroups: [
            { mode: 'LINKED', weapons: { A: 'gun' } },
            { mode: 'ALTERNATING', weapons: {} },
          ],
        },
        'A',
        1,
      ).weaponGroups,
    ).toEqual([
      { mode: 'LINKED', weapons: {} },
      { mode: 'ALTERNATING', weapons: { A: 'gun' } },
    ]);
  });
  it('preserves bay identity on removal and fills intervening empty bays', () => {
    expect(equipVariantWing({ wings: ['first', 'second'] }, 0, '').wings).toEqual(['', 'second']);
    expect(equipVariantWing({}, 2, 'wing').wings).toEqual(['', '', 'wing']);
  });
  it('updates hullmod membership atomically across category conversions', () => {
    const data = { hullMods: ['other'], permaMods: [], sMods: [], sModdedBuiltIns: ['builtin'] };
    const strengthened = setVariantHullmod(data, 'mod', 's');
    expect(strengthened).toEqual({ ...data, hullMods: ['other', 'mod'], permaMods: ['mod'], sMods: ['mod'] });
    expect(setVariantHullmod(strengthened, 'mod', 'normal')).toEqual({ ...data, hullMods: ['other', 'mod'] });
    expect(setVariantHullmod(strengthened, 'mod', null)).toEqual(data);
  });
  it('preserves the formal module format and order', () => {
    expect(setVariantModule({ modules: [{ B: 'second' }, { A: 'first' }] }, 'A', 'new').modules).toEqual([{ B: 'second' }, { A: 'new' }]);
    expect(setVariantModule({ modules: { B: 'second', A: 'first' } }, 'B', '').modules).toEqual({ A: 'first' });
  });
  it.each([
    ['HYBRID', 'BALLISTIC', 'SMALL', '混合挂载要求武器与槽位尺寸一致'],
    ['SYNERGY', 'ENERGY', 'MEDIUM', ''],
    ['COMPOSITE', 'MISSILE', 'LARGE', '武器尺寸超过槽位'],
    ['BALLISTIC', 'ENERGY', 'SMALL', '挂载类型不兼容'],
  ])('checks %s mount against %s %s', (type, weaponType, size, reason) => {
    expect(weaponSlotCompatibility({ type, size: 'MEDIUM' }, { type: weaponType, size })).toBe(reason);
  });
  it('consumes the original mount override, restriction and size-level rules', () => {
    expect(
      weaponSlotCompatibility({ type: 'ENERGY', size: 'MEDIUM' }, { type: 'BALLISTIC', mountTypeOverride: 'HYBRID', size: 'MEDIUM' }),
    ).toBe('');
    expect(
      weaponSlotCompatibility({ type: 'ENERGY', size: 'MEDIUM' }, { type: 'HYBRID', size: 'MEDIUM', restrictToSpecifiedMountType: true }),
    ).toBe('挂载类型不兼容');
    expect(weaponSlotCompatibility({ type: 'ENERGY', size: 'LARGE' }, { type: 'ENERGY', size: 'SMALL' })).toBe(
      '同类型武器只能缩小一级挂载',
    );
    expect(weaponSlotCompatibility({ type: 'ENERGY', size: 'MEDIUM' }, { type: 'ENERGY', size: 'SMALL', aiHints: ['SYSTEM'] })).toBe(
      '挂载类型不兼容',
    );
  });
});
