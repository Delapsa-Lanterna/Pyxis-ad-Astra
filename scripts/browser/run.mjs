import { chromium } from 'playwright';
import { parseArgs } from 'node:util';
import { unlink, mkdir } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { compare, markdown, rotation } from './report.mjs';
import { verifyUI, verifyBrowserUI } from './ui.mjs';
import { summarize } from '../shared/sample-statistics.mjs';
import { TestWorkspace, reserveTestOutput } from '../shared/test-workspace.mjs';
import { performanceScenarios } from './scenarios.mjs';

/** @typedef {import('../../src/test/browser/contracts').RunOptions} RunOptions */
/** @typedef {import('../../src/test/browser/contracts').RoundResult} RoundResult */
/** @typedef {import('../../src/test/browser/contracts').RunResult} RunResult */
/** @typedef {{ environment(): Promise<Record<string, unknown>>, sampleRound(options: RunOptions, iteration: number, phase: RoundResult['phase']): Promise<RoundResult>, summarizeRun(options: RunOptions, samples: RoundResult[], environment: Record<string, unknown>): RunResult }} PageApi */
const { values } = parseArgs({
  options: {
    suite: { type: 'string', default: 'lists' },
    scene: { type: 'string' },
    count: { type: 'string' },
    warmup: { type: 'string', default: '2' },
    rounds: { type: 'string' },
    output: { type: 'string' },
    variant: { type: 'string', multiple: true },
    aa: { type: 'boolean' },
    'monitor-compare': { type: 'boolean' },
    url: { type: 'string' },
    directory: { type: 'string' },
    'first-open': { type: 'boolean' },
    'dev-smoke': { type: 'boolean' },
  },
});
let output;
if (values.output) output = resolve(values.output);
else {
  const reports = await TestWorkspace.create(resolve('node_modules/.cache/browser/reports'), 'run');
  output = reports.path('run.json');
}
const jsonOutput = await reserveTestOutput(output);
const artifacts = join(dirname(output), basename(output, '.json') + '-artifacts');
let markdownOutput;
try {
  markdownOutput = await reserveTestOutput(output.replace(/\.json$/, '') + '.md');
} catch (error) {
  await jsonOutput.handle.close();
  await unlink(output);
  throw error;
}
/** @type {import('playwright').Browser | null} */
let browserToClose = null;
const errors = [];
try {
  await mkdir(artifacts);
  const url = values.url ?? (values.suite === 'browser-ui' ? 'http://127.0.0.1:1461' : 'http://127.0.0.1:1462');
  const sceneNames = performanceScenarios.map(({ id }) => id);
  const workloads = /** @type {const} */ ({ lists: 'benchmark', stress: 'stress', resources: 'resources', smoke: 'stress' });
  const suite = /** @type {keyof typeof workloads} */ (values.suite);
  /** @type {{ label: string, url: string, monitor: boolean, policy: 'disabled' | 'enabled' | 'code' }[]} */
  const variants = values.variant
    ? values.variant.map((value) => {
        const [label, endpoint, monitor = 'off', policy = 'code'] = value.split(',');
        return { label, url: endpoint, monitor: monitor === 'on', policy: /** @type {'disabled' | 'enabled' | 'code'} */ (policy) };
      })
    : values['monitor-compare']
      ? [
          { label: 'disabled', url, monitor: false, policy: 'code' },
          { label: 'enabled', url, monitor: true, policy: 'enabled' },
        ]
      : values.aa
        ? [
            { label: 'A', url, monitor: false, policy: 'code' },
            { label: 'B', url, monitor: false, policy: 'code' },
          ]
        : [{ label: 'current', url, monitor: false, policy: 'code' }];
  /** @type {{scene: RunOptions['scene'], count: number, resourceSize: number}[]} */
  let cases =
    suite === 'lists'
      ? performanceScenarios.flatMap(({ id: scene, counts }) =>
          counts.map((count) => ({
            scene,
            count,
            resourceSize: 0,
          })),
        )
      : suite === 'resources'
        ? [32, 128, 512].map((resourceSize) => ({ scene: 'weapons', count: 100, resourceSize }))
        : sceneNames.map((scene) => ({ scene, count: scene === 'csv' ? 50 : 30, resourceSize: 0 }));
  if (values.scene) cases = cases.filter((item) => item.scene === values.scene);
  if (values.count)
    cases =
      suite === 'lists'
        ? cases.filter((item) => item.count === Number(values.count))
        : cases.map((item) => ({ ...item, count: Number(values.count) }));
  if (!['ui', 'browser-ui'].includes(values.suite) && !cases.length) throw Error('没有匹配的性能项目：' + (values.scene ?? values.suite));
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  });
  browserToClose = browser;
  const warmup = Number(values.warmup);
  const rounds = Number(values.rounds ?? (suite === 'stress' ? 100 : suite === 'smoke' ? 1 : 30));
  /** @type {RunResult[]} */
  const runs = [];
  /** @type {unknown[]} */
  const order = [];
  /** @type {{variant: string, options: RunOptions, result: RoundResult}[]} */
  const firstOpen = [];
  /** @type {ReturnType<typeof compare>[]} */
  const comparisons = [];
  /** @type {unknown[]} */
  let uiChecks = [];
  if (['ui', 'browser-ui'].includes(values.suite)) cases = [];
  /** @param {string} endpoint */
  async function newPage(endpoint) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error));
    page.on('console', (message) => {
      if (['warning', 'error'].includes(message.type())) errors.push(new Error(message.type() + ': ' + message.text()));
    });
    await page.goto(endpoint);
    if (values.suite === 'browser-ui') await page.locator('.browser-workspace-shell').waitFor();
    else await page.waitForFunction(() => 'testbed' in globalThis);
    return { context, page };
  }
  if (values.suite === 'ui') uiChecks = await verifyUI(browser, url, join(artifacts, 'ui'));
  if (values.suite === 'browser-ui') uiChecks = await verifyBrowserUI(browser, url, join(artifacts, 'browser-ui'));
  for (const item of cases) {
    const entries = [];
    try {
      for (const variant of variants) {
        const options = {
          ...item,
          workload: workloads[suite],
          warmup,
          rounds,
          monitor: variant.monitor,
          theme: /** @type {const} */ ('light'),
        };
        if (values['first-open']) {
          for (let iteration = 0; iteration < rounds; iteration++) {
            const cold = await newPage(variant.url);
            try {
              const result = await cold.page.evaluate(
                ({ options, iteration }) =>
                  /** @type {PageApi} */ (Reflect.get(globalThis, 'testbed')).sampleRound(options, iteration, 'first'),
                { options, iteration },
              );
              firstOpen.push({ variant: variant.label, options, result });
            } finally {
              await cold.context.close();
            }
          }
        }
        const { page, context } = await newPage(variant.url);
        entries.push({ variant, options, page, context, samples: /** @type {RoundResult[]} */ ([]) });
      }
      for (let iteration = 0; iteration < warmup + rounds; iteration++) {
        for (const index of rotation(entries.length, iteration)) {
          const entry = entries[index];
          const phase = /** @type {'warmup' | 'measurement'} */ (iteration < warmup ? 'warmup' : 'measurement');
          await entry.page.bringToFront();
          const sample = await entry.page.evaluate(
            ({ options, iteration, phase }) =>
              /** @type {PageApi} */ (Reflect.get(globalThis, 'testbed')).sampleRound(options, iteration, phase),
            { options: entry.options, iteration, phase },
          );
          entry.samples.push(sample);
          order.push({
            scene: item.scene,
            count: item.count,
            resourceSize: item.resourceSize,
            iteration,
            phase,
            variant: entry.variant.label,
          });
          console.log(
            JSON.stringify({
              scene: item.scene,
              count: item.count,
              iteration,
              phase,
              variant: entry.variant.label,
              error: sample.error,
              failed: sample.assertions.filter((assertion) => !assertion.pass),
            }),
          );
        }
        if (entries.some((entry) => entry.samples.at(-1)?.error)) break;
      }
      const group = [];
      for (const entry of entries) {
        const environment = await entry.page.evaluate(() => /** @type {PageApi} */ (Reflect.get(globalThis, 'testbed')).environment());
        const run = await entry.page.evaluate(
          ({ options, samples, environment }) =>
            /** @type {PageApi} */ (Reflect.get(globalThis, 'testbed')).summarizeRun(options, samples, environment),
          { options: entry.options, samples: entry.samples, environment },
        );
        run.environment = { ...run.environment, variant: entry.variant.label, browserVersion: browser.version() };
        runs.push(run);
        group.push(run);
      }
      for (let index = 1; index < group.length; index++) {
        const policy = entries[index].variant.policy;
        comparisons.push(compare(group[policy === 'enabled' ? index - 1 : 0], group[index], policy));
      }
    } finally {
      for (const entry of entries) await entry.context.close();
    }
  }
  const report = {
    artifacts,
    pass:
      runs.length === cases.length * variants.length &&
      runs.every((run) => run.pass) &&
      firstOpen.every((sample) => !sample.result.error && sample.result.assertions.every((assertion) => assertion.pass)) &&
      comparisons.flat().every((comparison) => comparison.pass),
    runs,
    order,
    firstOpen,
    firstOpenMetrics: variants.map((variant) => ({
      variant: variant.label,
      cases: cases.map((item) => ({
        scene: item.scene,
        count: item.count,
        resourceSize: item.resourceSize,
        metrics: Object.fromEntries(
          ['open', 'prepare', 'close'].map((metric) => [
            metric,
            summarize(
              firstOpen
                .filter(
                  (sample) =>
                    sample.variant === variant.label &&
                    sample.options.scene === item.scene &&
                    sample.options.count === item.count &&
                    sample.options.resourceSize === item.resourceSize,
                )
                .flatMap((sample) => (metric in sample.result.metrics ? [sample.result.metrics[metric]] : [])),
            ),
          ]),
        ),
      })),
    })),
    comparisons,
    uiChecks,
  };
  await jsonOutput.handle.writeFile(JSON.stringify(report, null, 2) + '\n', 'utf8');
  await markdownOutput.handle.writeFile(markdown(report), 'utf8');
  console.log(JSON.stringify({ output, pass: report.pass, runs: runs.length }));
  if (!report.pass) process.exitCode = 1;
} catch (error) {
  errors.push(error);
} finally {
  try {
    await browserToClose?.close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length) {
    const report = { pass: false, errors: errors.map((error) => (error instanceof Error ? error.stack : String(error))) };
    await jsonOutput.handle.truncate(0);
    await jsonOutput.handle.write(JSON.stringify(report, null, 2) + '\n', 0, 'utf8');
    await markdownOutput.handle.truncate(0);
    await markdownOutput.handle.write('# 浏览器测试报告\n\n判定：失败\n\n' + report.errors.join('\n'), 0, 'utf8');
    process.exitCode = 1;
  }
  await jsonOutput.handle.close();
  await markdownOutput.handle.close();
  console.log(JSON.stringify({ output, resourcesReleased: !errors.length }));
}
