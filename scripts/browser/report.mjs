/** @param {{ pass: boolean, runs: import('../../src/test/browser/contracts.js').RunResult[], [key: string]: unknown }} report */
export function markdown(report) {
  const lines = [
    '# 浏览器测试报告',
    '',
    '判定：' + (report.pass ? '通过' : '失败'),
    '',
    '| 场景 | 规模 | 项目 | 预热 | 正式 | 通过 |',
    '|---|---:|---|---:|---:|---|',
  ];
  for (const run of report.runs) {
    lines.push(
      '| ' +
        [
          run.options.scene,
          run.options.count,
          run.options.workload,
          run.samples.filter((sample) => sample.phase === 'warmup').length,
          run.samples.filter((sample) => sample.phase === 'measurement').length,
          run.pass,
        ].join(' | ') +
        ' |',
    );
  }
  for (const run of report.runs) {
    lines.push(
      '',
      '## ' + run.options.scene + ' / ' + run.options.count,
      '',
      '| 指标 | 次数 | 最小 | 最大 | 均值 | 中位数 | P95 |',
      '|---|---:|---:|---:|---:|---:|---:|',
    );
    for (const [name, value] of Object.entries(run.metrics))
      lines.push('| ' + [name, value.n, value.min, value.max, value.mean, value.median, value.p95].join(' | ') + ' |');
    lines.push('', '参数：`' + JSON.stringify(run.options) + '`', '', '环境：`' + JSON.stringify(run.environment) + '`');
    const failures = run.samples.flatMap((sample) =>
      [sample.error, ...sample.assertions.filter((assertion) => !assertion.pass).map((assertion) => JSON.stringify(assertion))].filter(
        Boolean,
      ),
    );
    if (failures.length) lines.push('', '失败：', '', ...failures.map((failure) => '- ' + failure));
    lines.push('', '预算：`' + JSON.stringify(run.budgets) + '`');
  }
  if (report.comparisons) lines.push('', '## 交替比较', '', '```json', JSON.stringify(report.comparisons, null, 2), '```');
  if (report.firstOpen) lines.push('', '## 首次打开', '', '```json', JSON.stringify(report.firstOpen, null, 2), '```');
  if (report.firstOpenMetrics) lines.push('', '## 首次打开统计', '', '```json', JSON.stringify(report.firstOpenMetrics, null, 2), '```');
  if (report.uiChecks) lines.push('', '## 页面操作验收', '', '```json', JSON.stringify(report.uiChecks, null, 2), '```');
  if (report.order) lines.push('', '## 执行顺序', '', '```json', JSON.stringify(report.order, null, 2), '```');
  if (report.measurements) lines.push('', '## 代码编辑器测量', '', '```json', JSON.stringify(report.measurements, null, 2), '```');
  if (report.environments) lines.push('', '## 运行环境', '', '```json', JSON.stringify(report.environments, null, 2), '```');
  return lines.join('\n') + '\n';
}
