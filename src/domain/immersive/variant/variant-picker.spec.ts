import { describe, expect, it } from 'vitest';
import { weaponFilterDefaults, weaponFilterMatches } from './variant-picker';
import { weaponSlotCompatibility } from './variant-actions';

describe('weapon selector slot defaults and independent filters', () => {
  it.each([
    ['BALLISTIC', ['BALLISTIC']],
    ['ENERGY', ['ENERGY']],
    ['MISSILE', ['MISSILE']],
    ['HYBRID', ['BALLISTIC', 'ENERGY']],
    ['SYNERGY', ['ENERGY', 'MISSILE']],
    ['COMPOSITE', ['BALLISTIC', 'MISSILE']],
    ['UNIVERSAL', ['BALLISTIC', 'ENERGY', 'MISSILE']],
  ])('initializes all three sizes for %s slots from their original rule', (type, types) => {
    for (const size of ['SMALL', 'MEDIUM', 'LARGE']) {
      const pure = ['BALLISTIC', 'ENERGY', 'MISSILE'].includes(type as string);
      expect(weaponFilterDefaults({ type, size })).toEqual({
        types,
        sizes: pure ? { SMALL: ['SMALL'], MEDIUM: ['SMALL', 'MEDIUM'], LARGE: ['MEDIUM', 'LARGE'] }[size] : [size],
      });
    }
  });
  it('lets six values determine results independently of slot compatibility', () => {
    const spec = { type: 'ENERGY', size: 'LARGE' };
    expect(weaponFilterMatches(spec, ['ENERGY'], ['SMALL', 'MEDIUM'])).toBe(false);
    expect(weaponFilterMatches(spec, ['ENERGY'], ['SMALL', 'MEDIUM', 'LARGE'])).toBe(true);
    expect(weaponSlotCompatibility({ type: 'ENERGY', size: 'MEDIUM' }, spec)).toBe('武器尺寸超过槽位');
    expect(weaponFilterMatches(spec, [], ['LARGE'])).toBe(false);
    expect(weaponFilterMatches(spec, ['ENERGY'], [])).toBe(false);
  });
  it.each([
    ['HYBRID', ['BALLISTIC', 'ENERGY']],
    ['SYNERGY', ['ENERGY', 'MISSILE']],
    ['COMPOSITE', ['BALLISTIC', 'MISSILE']],
    ['UNIVERSAL', ['BALLISTIC', 'ENERGY', 'MISSILE']],
  ])('classifies %s mount overrides in the original type unions', (mountTypeOverride, allowed) => {
    for (const type of ['BALLISTIC', 'ENERGY', 'MISSILE']) {
      expect(weaponFilterMatches({ type: 'BALLISTIC', mountTypeOverride, size: 'MEDIUM' }, [type], ['MEDIUM'])).toBe(
        (allowed as string[]).includes(type),
      );
    }
  });
});
