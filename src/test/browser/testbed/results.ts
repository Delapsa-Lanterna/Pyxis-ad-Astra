import { createTestRun } from '../../../../scripts/shared/test-report.mjs';
import type { RunOptions, RunResult, RoundResult } from '../contracts';

const csvBudgets = {
  open: [75, 80, 90],
  roundTrip: [120, 140, 160],
  traverse: [30, 350, 4000],
  activate: [25, 30, 45],
  close: [20, 30, 50],
};

export function summarizeRun(options: RunOptions, samples: RoundResult[], environment: Record<string, unknown>): RunResult {
  const editor = options.scene.endsWith('-editor');
  const run = createTestRun({
    scenario: options.scene,
    parameters: editor
      ? {
          fileCount: options.count,
          fileBytes: options.fileBytes ?? 102400,
          textShape: options.textShape ?? 'multiline',
          workload: options.workload,
        }
      : { [options.scene === 'csv' ? 'rows' : 'entries']: options.count, resourcePixels: options.resourceSize, workload: options.workload },
    units: editor
      ? { fileCount: 'files', fileBytes: 'bytes' }
      : { [options.scene === 'csv' ? 'rows' : 'entries']: options.scene === 'csv' ? 'rows' : 'entries', resourcePixels: 'pixels' },
    execution: 'page',
    completion: '页面状态更新并完成绘制；保存接纳当前样本内容',
    environment,
    warmup: options.warmup,
    rounds: options.rounds,
    samples,
    budgets: [],
    resources: { released: true },
  });
  const metrics = run.metrics;
  const index = [50, 300, 2000].indexOf(options.count);
  const budgets =
    options.scene === 'csv' && options.workload === 'benchmark' && !options.resourceSize && index >= 0
      ? Object.entries(csvBudgets).map(([metric, limits]) => ({
          metric,
          statistic: 'median' as const,
          actual: metrics[metric]?.median ?? Infinity,
          maximum: limits[index]!,
          pass: (metrics[metric]?.median ?? Infinity) <= limits[index]!,
        }))
      : [];
  return {
    ...run,
    options,
    budgets,
    pass: run.pass && budgets.every((budget) => budget.pass),
  };
}
