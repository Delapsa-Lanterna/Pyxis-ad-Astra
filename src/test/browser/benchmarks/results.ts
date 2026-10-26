import { summarize } from '../../../../scripts/shared/sample-statistics.mjs';
import type { RunOptions, RunResult, RoundResult } from '../contracts';

const csvBudgets = {
  open: [75, 80, 90],
  roundTrip: [120, 130, 150],
  traverse: [25, 250, 3000],
  activate: [20, 20, 40],
  close: [20, 30, 50],
};

export function summarizeRun(options: RunOptions, samples: RoundResult[], environment: Record<string, unknown>): RunResult {
  const measured = samples.filter((sample) => sample.phase === 'measurement');
  const names = [...new Set(measured.flatMap((sample) => Object.keys(sample.metrics)))];
  const metrics = Object.fromEntries(
    names.map((name) => [name, summarize(measured.flatMap((sample) => (name in sample.metrics ? [sample.metrics[name]!] : [])))]),
  );
  const index = [50, 300, 2000].indexOf(options.count);
  const budgets =
    options.scene === 'csv' && options.workload === 'benchmark' && !options.resourceSize && index >= 0
      ? Object.entries(csvBudgets).map(([metric, limits]) => ({
          metric,
          statistic: 'median',
          actual: metrics[metric]?.median ?? Infinity,
          maximum: limits[index]!,
          pass: (metrics[metric]?.median ?? Infinity) <= limits[index]!,
        }))
      : [];
  return {
    options,
    environment,
    samples,
    metrics,
    budgets,
    pass:
      samples.length === options.warmup + options.rounds &&
      samples.every((sample) => !sample.error && sample.assertions.every((assertion) => assertion.pass)) &&
      budgets.every((budget) => budget.pass),
  };
}
