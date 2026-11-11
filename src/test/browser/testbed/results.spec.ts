import { expect, it } from 'vitest';
import { summarizeRun } from './results';
import type { RunOptions, RoundResult } from '../contracts';

const options: RunOptions = {
  scene: 'weapons',
  count: 30,
  resourceSize: 0,
  monitor: false,
  theme: 'light',
  workload: 'benchmark',
  warmup: 2,
  rounds: 30,
};
const samples = (): RoundResult[] =>
  Array.from({ length: 32 }, (_, iteration) => ({
    iteration,
    phase: iteration < 2 ? 'warmup' : 'measurement',
    metrics: { open: iteration < 2 ? 10000 : 10 },
    assertions: [{ name: '正确结果', pass: true, actual: 1, expected: 1 }],
  }));
it('separates two warmup samples from all thirty measurements', () => {
  const result = summarizeRun(options, samples(), { buildHash: 'test' });
  expect(result.metrics.open).toMatchObject({ n: 30, median: 10, p95: 10 });
  expect(result.samples.filter((sample) => sample.phase === 'warmup')).toHaveLength(2);
  expect(result.pass).toBe(true);
});
it('fails incomplete runs, behavior failures and failed warmup operations', () => {
  expect(summarizeRun(options, samples().slice(1), {}).pass).toBe(false);
  const failed = samples();
  failed[0]!.assertions[0]!.pass = false;
  expect(summarizeRun(options, failed, {}).pass).toBe(false);
  failed[0]!.error = 'operation failed';
  expect(summarizeRun(options, failed, {}).pass).toBe(false);
});
it('records slow measurements and accepts correct completed operations', () => {
  const slow = samples();
  for (const sample of slow) sample.metrics.open = 100000;
  const result = summarizeRun({ ...options, scene: 'csv', count: 2000 }, slow, {});
  expect(result.pass).toBe(true);
  expect(result.metrics.open?.p95).toBe(100000);
});

it('retains stage memory and history separately from timed metrics', () => {
  const measured = samples();
  const resources = {
    heapPhases: [{ phase: 'undo-0', usedJSHeapSize: 1234 }],
    history: [{ cycle: 0, operation: 'undo', step: 0, milliseconds: 5 }],
  };
  measured.at(-1)!.resources = resources;
  const result = summarizeRun(options, measured, {});
  expect(result.resources).toEqual({ released: true, stages: [resources] });
  expect(Object.keys(result.metrics)).toEqual(['open']);
  expect(result.pass).toBe(true);
});
