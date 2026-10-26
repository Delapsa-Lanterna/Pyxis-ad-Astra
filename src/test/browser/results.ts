import { markdown } from '../../../scripts/browser/report.mjs';
import type { RunResult } from './contracts';

export function showResults(element: HTMLElement, runs: RunResult[]) {
  const report = { pass: runs.every((run) => run.pass), runs };
  element.textContent = markdown(report);
  return report;
}
export function downloadReport(report: { pass: boolean; runs: RunResult[]; [key: string]: unknown }, format: 'json' | 'md') {
  const data = format === 'json' ? JSON.stringify(report, null, 2) : markdown(report);
  const url = URL.createObjectURL(new Blob([data], { type: format === 'json' ? 'application/json' : 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'testbed.' + format;
  link.click();
  URL.revokeObjectURL(url);
}
