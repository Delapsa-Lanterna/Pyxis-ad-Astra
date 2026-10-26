import type { RunResult } from '../../src/test/browser/contracts';
export function rotation(groups: number, iteration: number): number[];
export function compare(
  before: RunResult,
  after: RunResult,
  policy?: 'disabled' | 'enabled' | 'code',
): {
  metric: string;
  statistic: string;
  baseline: number;
  actual: number;
  maximum: number | null;
  pass: boolean;
}[];
export function markdown(report: { pass: boolean; runs: RunResult[]; [key: string]: unknown }): string;
