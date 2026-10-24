import { describe, expect, it } from 'vitest';
import { stableDeepEqual, stableStringify } from './stable-compare';

describe('structural equality', () => {
  it.each([
    [
      { a: 1, b: { c: [1, 2] } },
      { b: { c: [1, 2] }, a: 1 },
    ],
    [
      [1, 2],
      [2, 1],
    ],
    [[2, 2], [2]],
    [new Array(2), [undefined, undefined]],
    [new Array(1), [1]],
    [[null], [undefined]],
    [{ optional: undefined }, {}],
    [null, Number.NaN],
    [JSON.parse('{"__proto__":1}'), JSON.parse('{"__proto__":2}')],
  ])('preserves stable serialization equality for %j and %j', (left, right) => {
    expect(stableDeepEqual(left, right)).toBe(stableStringify(left) === stableStringify(right));
  });
  it('preserves object order when requested by field rows', () => {
    expect(stableDeepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }, true)).toBe(false);
    expect(stableDeepEqual([{ a: 1, b: 2 }], [{ b: 2, a: 1 }], true)).toBe(false);
  });
  it('stops before reading later values after a mismatch', () => {
    let reads = 0;
    const left = {
      first: 1,
      get later() {
        reads++;
        return 3;
      },
    };
    expect(stableDeepEqual(left, { first: 2, later: 3 })).toBe(false);
    expect(reads).toBe(0);
  });
});
