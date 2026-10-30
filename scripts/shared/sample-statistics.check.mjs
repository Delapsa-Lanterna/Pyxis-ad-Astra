import assert from 'node:assert/strict';
import { test } from 'node:test';
import { summarize } from './sample-statistics.mjs';

test('summarizes ordered statistics without changing the samples', () => {
  const values = [8, 2, 6, 4];
  assert.deepEqual(summarize(values), { n: 4, min: 2, max: 8, mean: 5, median: 5, p95: 8 });
  assert.deepEqual(values, [8, 2, 6, 4]);
  assert.deepEqual(summarize([9]), { n: 1, min: 9, max: 9, mean: 9, median: 9, p95: 9 });
});

test('uses nearest-rank P95 and the middle value for odd sample counts', () => {
  const result = summarize(Array.from({ length: 21 }, (_, index) => index + 1));
  assert.equal(result.median, 11);
  assert.equal(result.p95, 20);
});

test('expresses empty aggregate statistics as NaN with absent extrema', () => {
  assert.deepEqual(summarize([]), { n: 0, min: undefined, max: undefined, mean: NaN, median: NaN, p95: NaN });
});
