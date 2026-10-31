import { describe, expect, it } from 'vitest';
import { inferWeaponSpecClass } from './weapon-spec';

describe('weapon spec class inference', () => {
  it.each([
    [{}, 'projectile'],
    [{ 'damage/second': '1', 'energy/second': '2', 'damage/shot': '3' }, 'beam'],
    [{ 'damage/shot': '1', 'energy/shot': '2', 'beam speed': '3' }, 'projectile'],
    [{ 'damage/shot': '1', 'beam speed': '2' }, 'projectile'],
    [{ 'damage/shot': '   ', 'beam speed': '0' }, 'beam'],
    [{ 'damage/shot': '0', 'energy/shot': '0', 'beam speed': '5' }, 'projectile'],
  ] as const)('scores populated columns in %j as %s', (row, expected) => {
    expect(inferWeaponSpecClass(row)).toBe(expected);
  });
});
