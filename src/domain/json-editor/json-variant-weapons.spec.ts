import { describe, expect, it } from 'vitest';
import { transferVariantWeaponSlots } from './json-variant-weapons';
import type { RowData } from '@/shared/types';

describe('variant weapon slot transfers', () => {
  it.each([0, 1])('moves the equipped weapon to group %s in one document update', (destination) => {
    const source = 1 - destination;
    const groups: { mode: string; weapons: Record<string, string> }[] = [
      { mode: 'LINKED', weapons: { A: 'gun-a' } },
      { mode: 'ALTERNATING', weapons: { B: 'gun-b' } },
    ];
    const previous = { weaponGroups: groups, custom: 'kept' };
    const slot = source === 0 ? 'A' : 'B';
    const next = {
      ...previous,
      weaponGroups: groups.map((group, index) => (index === destination ? { ...group, weapons: { ...group.weapons, [slot]: '' } } : group)),
    };
    const result = transferVariantWeaponSlots(previous, next);
    expect(result).toEqual({
      ...previous,
      weaponGroups: groups.map((group, index) => ({ ...group, weapons: index === destination ? { A: 'gun-a', B: 'gun-b' } : {} })),
    });
    expect(previous.weaponGroups).toEqual(groups);
    expect(next.weaponGroups[source]!.weapons).toHaveProperty(slot);
  });

  it('retains weapon edits, empty groups and group removal', () => {
    const previous: { weaponGroups: RowData[] } = { weaponGroups: [{ weapons: { A: 'gun' } }, { weapons: { B: 'other' } }] };
    const edited: RowData = { weaponGroups: [{ weapons: { A: 'changed' } }, { weapons: {} }] };
    expect(transferVariantWeaponSlots(previous, edited)).toEqual(edited);
    const removed = { weaponGroups: [previous.weaponGroups[1]!] };
    expect(transferVariantWeaponSlots(previous, removed)).toEqual(removed);
  });
});
