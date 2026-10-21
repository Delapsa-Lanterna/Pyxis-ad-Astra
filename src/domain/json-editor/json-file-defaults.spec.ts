import { describe, expect, it } from 'vitest';
import { createDefaultSkin, createDefaultVariant } from './json-file-defaults';

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
