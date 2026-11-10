import { markdown, type TestReport } from '../../../../scripts/shared/test-report.mjs';
import type { TestRun } from '../../../../scripts/shared/test-report.mjs';

export function showResults(element: HTMLElement, runs: TestRun[]) {
  const report: TestReport = {
    kind: 'testbed',
    pass: runs.every((run) => run.pass),
    runs,
    checks: [],
    errors: [],
    resourcesReleased: true,
  };
  element.textContent = markdown(report);
  return report;
}
export function downloadReport(report: TestReport, format: 'json' | 'md') {
  const data = format === 'json' ? JSON.stringify(report, null, 2) : markdown(report);
  const url = URL.createObjectURL(new Blob([data], { type: format === 'json' ? 'application/json' : 'text/markdown' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'testbed.' + format;
  link.click();
  URL.revokeObjectURL(url);
}
