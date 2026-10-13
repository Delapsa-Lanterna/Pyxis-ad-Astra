import { describe, expect, it } from 'vitest';
import type { RowData } from '@/shared/types';
import { rendersLoadedMissiles, sortMountedWeapons, weaponRenderOrder } from './weapon-render-order';

const spec: RowData = { specClass: 'projectile', size: 'MEDIUM', type: 'BALLISTIC' };
const slot: RowData = { id: 'WS1', size: 'LARGE', mount: 'TURRET', locations: [0, 0] };

describe('native mounted weapon order', () => {
  it.each([
    ['SMALL', 'HARDPOINT', 0],
    ['MEDIUM', 'HARDPOINT', 2],
    ['LARGE', 'HARDPOINT', 4],
    ['SMALL', 'TURRET', 20],
    ['MEDIUM', 'TURRET', 22],
    ['LARGE', 'TURRET', 24],
    ['SMALL', 'HIDDEN', 20],
  ])('uses the spec size %s and mount %s', (size, mount, expected) => {
    expect(weaponRenderOrder({ ...spec, size }, { ...slot, mount }, [])).toBe(expected);
  });
  it.each([
    [-50, -28],
    [0.25, 22.25],
    [100000, 100022],
  ])('adds modifier %s to the final order', (renderOrderMod, expected) => {
    expect(weaponRenderOrder(spec, { ...slot, renderOrderMod }, [])).toBe(expected);
  });
  it('gives Below precedence and permits numeric modifiers to cross Above', () => {
    expect(
      weaponRenderOrder({ ...spec, renderBelowAllWeapons: true, renderAboveAllWeapons: true }, { ...slot, renderOrderMod: 7 }, []),
    ).toBe(7);
    expect(weaponRenderOrder({ ...spec, renderAboveAllWeapons: true }, { ...slot, renderOrderMod: -2 }, [])).toBe(99998);
    expect(weaponRenderOrder(spec, { ...slot, renderOrderMod: 200000 }, [])).toBe(200022);
  });
  it.each([
    [[], 0.01001],
    [['WEAPONS_FRONT_TO_BACK'], 0.012],
    [['WEAPONS_BACK_TO_FRONT'], -0.008],
    [['WEAPONS_FRONT_TO_BACK', 'WEAPONS_BACK_TO_FRONT'], 0.012],
  ])('applies the hull location rule %j', (hints, position) => {
    expect(weaponRenderOrder({ ...spec, renderBelowAllWeapons: true }, { ...slot, locations: [100, -100] }, hints)).toBeCloseTo(
      -position,
      7,
    );
  });
  it('takes beam Above from the loader default and keeps pulse at its simple order', () => {
    expect(weaponRenderOrder({ ...spec, specClass: 'beam', renderAboveAllWeapons: true }, slot, [])).toBe(22);
    expect(weaponRenderOrder({ ...spec, specClass: 'beam', renderBelowAllWeapons: true }, slot, [])).toBe(0);
    expect(
      weaponRenderOrder(
        { ...spec, specClass: 'pulse', renderBelowAllWeapons: true },
        { ...slot, renderOrderMod: 3, locations: [100, 200] },
        [],
      ),
    ).toBe(22);
  });
  it.each([
    ['TURRET', 'RENDER_LOADED_MISSILES', 21],
    ['HIDDEN', 'RENDER_LOADED_MISSILES', 21],
    ['TURRET', 'RENDER_LOADED_MISSILES_UNLESS_HIDDEN', 21],
    ['HIDDEN', 'RENDER_LOADED_MISSILES_UNLESS_HIDDEN', 22],
  ])('applies loaded-missile adjustment for %s and %s', (mount, hint, expected) => {
    expect(weaponRenderOrder({ ...spec, type: 'MISSILE', renderHints: [hint] }, { ...slot, mount }, [])).toBe(expected);
    expect(weaponRenderOrder({ ...spec, renderHints: [hint] }, { ...slot, mount }, [])).toBe(22);
  });
  it('uses float equality and UTF-16 slot IDs while retaining the source slot array', () => {
    const weapons = ['WS2', 'WS10', '\uE000', '😀'].map((id, index) => {
      const ownSlot = { ...slot, id, renderOrderMod: index * 0.00000001 };
      return { slot: ownSlot, renderOrder: weaponRenderOrder(spec, ownSlot, []) };
    });
    expect(new Set(weapons.map((weapon) => weapon.renderOrder)).size).toBe(1);
    expect(sortMountedWeapons(weapons).map((weapon) => weapon.slot.id)).toEqual(['WS10', 'WS2', '😀', '\uE000']);
    expect(weapons.map((weapon) => weapon.slot.id)).toEqual(['WS2', 'WS10', '\uE000', '😀']);
  });
  it('distinguishes the unconditional and visible-only loaded missile hints', () => {
    expect(rendersLoadedMissiles({ renderHints: ['RENDER_LOADED_MISSILES'] }, true)).toBe(true);
    expect(rendersLoadedMissiles({ renderHints: ['RENDER_LOADED_MISSILES_UNLESS_HIDDEN'] }, true)).toBe(false);
  });
});
