import { describe, expect, it } from 'vitest';
import { renameVariantModules, setVariantModule, variantModuleEntries } from './json-variant-modules';
import type { JsonValue } from '@/shared/types';

describe('variant module identity', () => {
  it.each([false, true])('preserves module order and unknown content during identity changes', (array) => {
    const modules: JsonValue = array ? [{ B: 'old' }, { A: 'other' }] : { B: 'old', A: 'other' };
    const source = { variantId: 'root', modules, custom: { value: 3 } };
    const renamed = renameVariantModules(source, 'old', 'new');
    expect(variantModuleEntries(renamed.modules)).toEqual([
      ['B', 'new'],
      ['A', 'other'],
    ]);
    expect(renamed.custom).toEqual({ value: 3 });
    expect(Array.isArray(renamed.modules)).toBe(Array.isArray(modules));
    expect(variantModuleEntries(setVariantModule(renamed, 'B', '').modules)).toEqual([['A', 'other']]);
    expect(variantModuleEntries(source.modules)).toEqual([
      ['B', 'old'],
      ['A', 'other'],
    ]);
  });
});
