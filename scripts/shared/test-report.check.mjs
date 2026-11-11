import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdown, createTestRun } from './test-report.mjs';
import { rotation, compare } from './sample-statistics.mjs';

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

/** @param {number} time @returns {import('./test-report.mjs').TestRun} */
function report(time) {
  return createTestRun({
    scenario: 'weapons',
    parameters: { entries: 30 },
    units: { entries: 'entries' },
    execution: 'page',
    completion: 'Visible sample ready',
    environment: {},
    warmup: 0,
    rounds: 1,
    samples: [{ iteration: 0, phase: 'measurement', metrics: { open: time }, assertions: [] }],
    resources: { released: true },
  });
}
test('records absolute comparison differences for slow measurements', () => {
  const result = compare(report(100).metrics, report(10000).metrics);
  assert.equal(result.length, 2);
  assert.ok(result.every((entry) => entry.delta === 9900));
  assert.equal(report(10000).pass, true);
});
test('exports the same measured values and environment to the readable report', () => {
  const run = report(42);
  run.environment = { buildHash: 'fixed-build', dpr: 1.5 };
  const text = markdown({ kind: 'testbed', pass: true, runs: [run], checks: [], errors: [], resourcesReleased: true });
  assert.match(text, /42/);
  assert.match(text, /fixed-build/);
  assert.match(text, /"dpr":1.5/);
});

test('keeps partial samples and fails incomplete, failed warmup and behavior runs', () => {
  const run = report(12);
  run.rounds = 2;
  assert.equal(createTestRun(run).pass, false);
  assert.equal(createTestRun(run).samples.length, 1);
  run.samples.push({ iteration: 1, phase: 'measurement', metrics: { open: 14 }, assertions: [] });
  assert.equal(createTestRun(run).pass, true);
  run.warmup = 1;
  run.samples.unshift({ iteration: 0, phase: 'warmup', metrics: { open: 10000 }, assertions: [], error: 'Sample failed' });
  assert.equal(createTestRun(run).pass, false);
  assert.equal(createTestRun(run).metrics.open?.median, 13);
  const warmup = run.samples[0];
  assert.ok(warmup);
  warmup.error = undefined;
  warmup.assertions.push({ name: 'Sample state', pass: false, actual: 0, expected: 1 });
  assert.equal(createTestRun(run).pass, false);
});

test('reports completed samples, raw failures and resource state together', () => {
  const run = report(24);
  run.resources = { released: false, heapUsedBytes: 1234 };
  run.samples.push({ iteration: 1, phase: 'failure', metrics: {}, assertions: [], error: 'Sample interrupted' });
  const readable = markdown({
    kind: 'testbed',
    pass: false,
    runs: [createTestRun(run)],
    checks: [{ name: 'Window release', pass: false }],
    errors: ['Transport failed'],
    resourcesReleased: false,
  });
  for (const value of ['24', '1234', 'Sample interrupted', 'Window release', 'Transport failed', 'entries'])
    assert.ok(readable.includes(value));
});
