import { createTestRun } from '../../../../scripts/shared/test-report.mjs';
import type { RunOptions, RunResult, RoundResult } from '../contracts';
import { performanceScenarios } from './scenarios';

export function summarizeRun(options: RunOptions, samples: RoundResult[], environment: Record<string, unknown>): RunResult {
  const definition = performanceScenarios.find(({ id }) => id === options.scene)!;
  const editor = Boolean(definition.keyboard);
  const run = createTestRun({
    scenario: options.scene,
    parameters: editor
      ? {
          fileCount: options.count,
          fileBytes: options.fileBytes ?? 102400,
          textShape: options.textShape ?? 'multiline',
          workload: options.workload,
        }
      : definition.immersive
        ? { unrelatedVariants: options.count, workload: options.workload }
        : {
            [options.scene === 'csv' ? 'rows' : 'entries']: options.count,
            resourcePixels: options.resourceSize,
            workload: options.workload,
          },
    units: editor
      ? { fileCount: 'files', fileBytes: 'bytes' }
      : definition.immersive
        ? { unrelatedVariants: 'files' }
        : { [options.scene === 'csv' ? 'rows' : 'entries']: options.scene === 'csv' ? 'rows' : 'entries', resourcePixels: 'pixels' },
    execution: 'page',
    completion: '页面状态更新并完成绘制；保存接纳当前样本内容',
    environment,
    warmup: options.warmup,
    rounds: options.rounds,
    samples,
    resources: { released: true, stages: samples.flatMap((sample) => (sample.resources ? [sample.resources] : [])) },
  });
  return { ...run, options };
}
