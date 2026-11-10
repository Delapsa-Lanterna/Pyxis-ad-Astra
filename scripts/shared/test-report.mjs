import { summarize } from './sample-statistics.mjs';

/** @typedef {{name:string,pass:boolean,actual?:string|number|boolean,expected?:string|number|boolean,milliseconds?:number}} TestCheck */
/** @typedef {{iteration:number,phase:string,metrics:Record<string,number>,assertions:TestCheck[],error?:string}} TestSample */
/** @typedef {{metric:string,statistic:'median'|'p95',actual:number,maximum:number,pass:boolean}} TestBudget */
/** @typedef {{scenario:string,parameters:Record<string,string|number|boolean>,units:Record<string,string>,execution:'page'|'keyboard'|'native',completion:string,environment:Record<string,unknown>,warmup:number,rounds:number,samples:TestSample[],metrics:Record<string,ReturnType<typeof summarize>>,budgets:TestBudget[],resources:Record<string,unknown>,pass:boolean}} TestRun */
/** @typedef {{kind:'preview'|'testbed'|'desktop',pass:boolean,runs:TestRun[],checks:TestCheck[],errors:string[],resourcesReleased:boolean,[key:string]:unknown}} TestReport */

/** @param {Omit<TestRun,'metrics'|'pass'>} input @returns {TestRun} */
export function createTestRun(input) {
  const measured = input.samples.filter((sample) => sample.phase === 'measurement');
  const names = [...new Set(measured.flatMap((sample) => Object.keys(sample.metrics)))];
  const metrics = Object.fromEntries(names.map((name) => [name, summarize(measured.flatMap((sample) => sample.metrics[name] ?? []))]));
  return {
    ...input,
    metrics,
    pass:
      input.samples.filter((sample) => sample.phase === 'warmup').length === input.warmup &&
      measured.length === input.rounds &&
      input.samples.every((sample) => !sample.error && sample.assertions.every((check) => check.pass)) &&
      input.budgets.every((budget) => budget.pass),
  };
}

/** @param {TestReport} report */
export function markdown(report) {
  const lines = [
    '# 测试报告',
    '',
    '用途：' + report.kind,
    '',
    '判定：' + (report.pass ? '通过' : '失败'),
    '',
    '| 场景 | 参数 | 预热 | 正式 | 结果 |',
    '|---|---|---:|---:|---|',
  ];
  for (const run of report.runs)
    lines.push(
      '| ' +
        [
          run.scenario,
          JSON.stringify(run.parameters),
          run.samples.filter((sample) => sample.phase === 'warmup').length,
          run.samples.filter((sample) => sample.phase === 'measurement').length,
          run.pass ? '通过' : '失败',
        ].join(' | ') +
        ' |',
    );
  for (const run of report.runs) {
    lines.push(
      '',
      '## ' + run.scenario,
      '',
      '操作方式：' + run.execution,
      '',
      '完成条件：' + run.completion,
      '',
      '参数：`' + JSON.stringify(run.parameters) + '`',
      '',
      '单位：`' + JSON.stringify(run.units) + '`',
      '',
      '环境：`' + JSON.stringify(run.environment) + '`',
      '',
      '| 指标 | 次数 | 最小 | 最大 | 均值 | 中位数 | P95 |',
      '|---|---:|---:|---:|---:|---:|---:|',
    );
    for (const [name, value] of Object.entries(run.metrics))
      lines.push('| ' + [name, value.n, value.min, value.max, value.mean, value.median, value.p95].join(' | ') + ' |');
    lines.push('', '预算：`' + JSON.stringify(run.budgets) + '`', '', '资源：`' + JSON.stringify(run.resources) + '`');
    for (const sample of run.samples) {
      if (sample.error) lines.push('', '- ' + sample.phase + ' ' + sample.iteration + ': ' + sample.error);
      for (const check of sample.assertions.filter((check) => !check.pass)) lines.push('- ' + JSON.stringify(check));
    }
  }
  lines.push('', '## 功能检查', '', '| 检查 | 结果 | 耗时 (ms) |', '|---|---|---:|');
  for (const check of report.checks)
    lines.push('| ' + [check.name, check.pass ? '通过' : '失败', check.milliseconds?.toFixed(2) ?? ''].join(' | ') + ' |');
  lines.push(
    '',
    '## 运行与释放',
    '',
    '```json',
    JSON.stringify(Object.fromEntries(Object.entries(report).filter(([key]) => !['runs', 'checks', 'errors'].includes(key))), null, 2),
    '```',
  );
  if (report.errors.length) lines.push('', '## 诊断', '', ...report.errors.map((error) => '- ' + error));
  return lines.join('\n') + '\n';
}
