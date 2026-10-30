/** @param {number} groups @param {number} iteration */
export const rotation = (groups, iteration) => Array.from({ length: groups }, (_, offset) => (iteration + offset) % groups);

/** @param {import('../../src/test/browser/contracts.js').RunResult} before @param {import('../../src/test/browser/contracts.js').RunResult} after @param {'disabled' | 'enabled' | 'code'} policy */
export function compare(before, after, policy = 'code') {
  const ratio = policy === 'disabled' ? 0.01 : 0.1;
  const floor = policy === 'disabled' ? 1 : 5;
  return ['open', 'roundTrip', 'traverse', 'activate', 'close'].flatMap((metric) => {
    const measured = before.metrics[metric];
    if (!measured) return [];
    return /** @type {const} */ (['median', 'p95']).map((statistic) => {
      const baseline = measured[statistic];
      const actual = after.metrics[metric]?.[statistic] ?? Infinity;
      const maximum = policy === 'code' ? null : baseline + Math.max(baseline * ratio, floor);
      return { metric, statistic, baseline, actual, maximum, pass: maximum === null || actual <= maximum };
    });
  });
}

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
  return lines.join('\n') + '\n';
}
