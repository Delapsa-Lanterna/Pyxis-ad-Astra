import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rotation, compare, markdown } from './report.mjs';

test('balances two and three comparison groups by rotating the first group', () => {
  assert.deepEqual(
    [0, 1, 2, 3].map((round) => rotation(2, round)),
    [
      [0, 1],
      [1, 0],
      [0, 1],
      [1, 0],
    ],
  );
  assert.deepEqual(
    [0, 1, 2].map((round) => rotation(3, round)),
    [
      [0, 1, 2],
      [1, 2, 0],
      [2, 0, 1],
    ],
  );
});

/** @param {number} time @returns {import('../../src/test/browser/contracts').RunResult} */
function report(time) {
  return {
    options: {
      scene: 'settings',
      count: 30,
      resourceSize: 0,
      monitor: false,
      theme: 'light',
      workload: 'benchmark',
      warmup: 2,
      rounds: 30,
    },
    environment: {},
    samples: [],
    budgets: [],
    pass: true,
    metrics: { open: { n: 30, min: time, max: time, mean: time, median: time, p95: time } },
  };
}
test('enforces the existing monitor overhead budgets and leaves code comparisons informative', () => {
  assert.equal(
    compare(report(100), report(101), 'disabled').every((item) => item.pass),
    true,
  );
  assert.equal(
    compare(report(100), report(102), 'disabled').every((item) => item.pass),
    false,
  );
  assert.equal(
    compare(report(100), report(110), 'enabled').every((item) => item.pass),
    true,
  );
  assert.equal(
    compare(report(100), report(111), 'enabled').every((item) => item.pass),
    false,
  );
  assert.equal(
    compare(report(1), report(6), 'enabled').every((item) => item.pass),
    true,
  );
  assert.equal(
    compare(report(1), report(100), 'code').every((item) => item.pass),
    true,
  );
});
test('exports the same measured values and environment to the readable report', () => {
  const run = report(42);
  run.environment = { buildHash: 'fixed-build', dpr: 1.5 };
  const text = markdown({ pass: true, runs: [run] });
  assert.match(text, /42/);
  assert.match(text, /fixed-build/);
  assert.match(text, /"dpr":1.5/);
});
