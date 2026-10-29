import { describe, expect, expectTypeOf, it } from 'vitest';
import { hullWeaponSlotOptions, hullReferenceOptions } from './hull-references';
import { mapSourceGroupsToSelectOptions } from '@/domain/schema/schema-options';
import type { SelectOption, FlatSelectOption } from '@/domain/schema/schema-options';
import type { ResourceRef } from '@/shared/types';

describe('built-in slot origins', () => {
  it('preserves the backend origin through option grouping and labels', async () => {
    const groups = hullWeaponSlotOptions(
      {
        groups: [],
        hullNames: {},
        sprites: {},
        weaponSlots: {},
        moduleSlots: {},
        builtInWeaponSlots: {
          hull: [
            { id: 'CORE', origin: 'core' },
            { id: 'MOD', origin: 'mod', size: 'MEDIUM', type: 'ENERGY', mount: 'HARDPOINT' },
            { id: 'CUSTOM', origin: 'mod', type: 'CUSTOM_TYPE' },
          ],
        },
      },
      'hull',
    );
    expect(groups.map((group) => [group.origin, group.options[0]?.value])).toEqual([
      ['mod', 'MOD'],
      ['core', 'CORE'],
    ]);
    const options = mapSourceGroupsToSelectOptions(groups);
    expect(options[0]?.label).toBe('当前 Mod');
    expect(options[1]?.label).toBe('原版');
    expect(options[0]?.children).toMatchObject([
      { value: 'MOD', label: 'MOD · 能量 · 中型 · 固定' },
      { value: 'CUSTOM', label: 'CUSTOM · CUSTOM_TYPE' },
    ]);
    expect(options[1]?.children?.[0]).toMatchObject({ value: 'CORE', label: 'CORE' });
  });
});

describe('hull option resource ownership', () => {
  it('preserves the shared readonly reference across Hull and select projections', () => {
    const resource = { source: 'mod' as const, relPath: 'graphics/hull.png', ownerKind: 'ship' as const, ownerId: 'hull', key: 'sprite' };
    const result = hullReferenceOptions({
      groups: [
        { origin: 'mod', kind: 'ship', options: [{ label: 'Hull', value: 'hull', origin: 'mod', kind: 'ship', resourceRef: resource }] },
      ],
      hullNames: {},
      sprites: {},
      builtInWeaponSlots: {},
      weaponSlots: {},
      moduleSlots: {},
    });
    const option = result[0]!;
    expect(option.resourceRef).toBe(resource);
    expectTypeOf<NonNullable<SelectOption['resourceRef']>>().toEqualTypeOf<Readonly<ResourceRef>>();
    expectTypeOf<NonNullable<FlatSelectOption['resourceRef']>>().toEqualTypeOf<Readonly<ResourceRef>>();
  });
});
