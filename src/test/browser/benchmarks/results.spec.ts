import { expect, it } from 'vitest';
import { summarizeRun } from './results';
import type { RunOptions, RoundResult } from '../contracts';

const options: RunOptions = {
  scene: 'settings',
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
it('enforces CSV budgets only on their defined baseline workload', () => {
  const result = summarizeRun({ ...options, scene: 'csv', count: 50 }, samples(), {});
  expect(result.budgets).toHaveLength(5);
  expect(result.pass).toBe(false);
  expect(summarizeRun({ ...options, scene: 'csv', workload: 'stress' }, samples(), {}).budgets).toEqual([]);
});
