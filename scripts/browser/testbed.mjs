import { parseArgs } from 'node:util';
import { runBrowser } from './runtime.mjs';
import { performanceScenarios } from './testbed/scenarios.mjs';
import { keyboardCases } from './testbed/cases/registry.mjs';
import { verifyTestbed } from './testbed/cases/ui.mjs';
import { compare, rotation } from '../shared/sample-statistics.mjs';
import { createTestRun } from '../shared/test-report.mjs';

const { values } = parseArgs({
  options: {
    scene: { type: 'string' },
    workload: { type: 'string', default: 'benchmark' },
    execution: { type: 'string', default: 'keyboard' },
    rows: { type: 'string' },
    entries: { type: 'string' },
    files: { type: 'string' },
    bytes: { type: 'string' },
    shape: { type: 'string' },
    warmup: { type: 'string', default: '2' },
    rounds: { type: 'string' },
    url: { type: 'string' },
    output: { type: 'string' },
    variant: { type: 'string', multiple: true },
    aa: { type: 'boolean' },
    'monitor-compare': { type: 'boolean' },
    'first-open': { type: 'boolean' },
    'check-ui': { type: 'boolean' },
  },
});
await runBrowser('testbed', values, async ({ newPage, artifacts }) => {
  const runs = /** @type {import('../shared/test-report.mjs').TestRun[]} */ ([]),
    checks = /** @type {import('../shared/test-report.mjs').TestCheck[]} */ ([]),
    order = /** @type {{scene:string,count:number,iteration:number,variant:string}[]} */ ([]),
    comparisons = /** @type {ReturnType<typeof compare>} */ ([]),
    errors = /** @type {string[]} */ ([]);
  const scenes = performanceScenarios.filter(
    (scene) => (!values.scene || scene.id === values.scene) && (values.workload !== 'resources' || scene.id === 'weapons'),
  );
  if (!scenes.length) throw Error('没有匹配的性能项目：' + values.scene);
  if (!['benchmark', 'stress', 'resources'].includes(values.workload) || !['page', 'keyboard'].includes(values.execution))
    throw Error('Invalid workload or execution');
  const url = values.url ?? 'http://127.0.0.1:1462';
  const variants = values.variant
    ? values.variant.map((value) => {
        const [label, endpoint, monitor = 'off'] = value.split(',');
        if (!label || !endpoint) throw Error('--variant requires label,url[,monitor]');
        return { label, url: endpoint, monitor: monitor === 'on' };
      })
    : values.aa || values['monitor-compare']
      ? ['A', 'B'].map((label, index) => ({
          label,
          url,
          monitor: Boolean(values['monitor-compare'] && index),
        }))
      : [{ label: 'current', url, monitor: false }];
  const warmup = Number(values.warmup),
    rounds = Number(values.rounds ?? (values.workload === 'stress' ? 100 : 30));
  if (!Number.isInteger(warmup) || warmup < 0 || !Number.isInteger(rounds) || rounds < 1) throw Error('Invalid sample counts');
  try {
    if (values['check-ui']) {
      const entry = await newPage();
      checks.push(...(await verifyTestbed(entry.page, artifacts)));
      return { runs, checks, order, comparisons };
    }
    for (const definition of scenes) {
      const parameter = values[definition.scale],
        counts = parameter ? [Number(parameter)] : definition.counts;
      const sizes = definition.fileBytes
        ? values.bytes
          ? [Number(values.bytes)]
          : definition.fileBytes
        : values.workload === 'resources'
          ? [32, 128, 512]
          : [0];
      const shapes = definition.textShapes ? (values.shape ? [values.shape] : definition.textShapes) : ['multiline'];
      for (const count of counts)
        for (const fileBytes of sizes)
          for (const textShape of shapes) {
            if (
              !Number.isInteger(count) ||
              count < 1 ||
              (definition.id === 'text-editor' && count !== 1) ||
              !['multiline', 'long-line'].includes(textShape) ||
              (definition.fileBytes && (!Number.isInteger(fileBytes) || fileBytes < 4))
            )
              throw Error('Invalid scene parameters');
            const entries = [];
            try {
              for (const variant of variants)
                entries.push({
                  ...(await newPage(variant.url)),
                  variant,
                  samples: /** @type {import('../../src/test/browser/contracts.js').RoundResult[]} */ ([]),
                });
              for (const entry of entries) entry.environment.variant = entry.variant.label;
              const options = /** @type {import('../../src/test/browser/contracts.js').RunOptions} */ ({
                scene: definition.id,
                count,
                resourceSize: values.workload === 'resources' ? fileBytes : 0,
                fileBytes,
                textShape,
                workload: values.workload,
                warmup,
                rounds,
                monitor: false,
                theme: 'light',
              });
              if (values['first-open'])
                for (const variant of variants) {
                  const cold = createTestRun({
                    scenario: definition.id,
                    parameters: {
                      cache: 'cold',
                      [definition.scale === 'files' ? 'fileCount' : definition.scale]: count,
                      fileBytes,
                      textShape,
                    },
                    units: { [definition.scale]: definition.scale },
                    execution: 'page',
                    completion: '独立浏览器上下文中的首次样本就绪',
                    environment: { variant: variant.label },
                    warmup: 0,
                    rounds,
                    samples: [],
                    resources: { released: false },
                  });
                  runs.push(cold);
                  for (let iteration = 0; iteration < rounds; iteration++) {
                    const entry = await newPage(variant.url);
                    try {
                      const sample = definition.keyboard
                        ? await entry.page.evaluate(async (options) => {
                            const opened = await Reflect.get(globalThis, 'testbed').openEditor(options);
                            return { iteration: 0, phase: 'measurement', metrics: { open: opened.openMilliseconds }, assertions: [] };
                          }, options)
                        : await entry.page.evaluate(
                            ({ options, iteration }) => Reflect.get(globalThis, 'testbed').sampleRound(options, iteration, 'measurement'),
                            { options, iteration },
                          );
                      cold.samples.push({ ...sample, iteration });
                      cold.environment = entry.environment;
                    } finally {
                      await entry.page.evaluate(() => Reflect.get(globalThis, 'testbed').close());
                      await entry.context.close();
                    }
                  }
                  cold.resources.released = true;
                  Object.assign(cold, createTestRun(cold));
                }
              const keyboard = definition.keyboard && keyboardCases[definition.keyboard];
              if (keyboard && values.execution === 'keyboard') {
                const groups = entries.map((entry) => keyboard(entry, { ...options, monitor: entry.variant.monitor }, runs));
                try {
                  for (let iteration = 0; iteration < warmup + rounds; iteration++)
                    for (const index of rotation(groups.length, iteration)) {
                      const group = groups[index],
                        entry = entries[index];
                      if (!group || !entry) throw Error('Missing measurement group');
                      await entry.page.bringToFront();
                      await group.next();
                      order.push({ scene: definition.id, count, iteration, variant: entry.variant.label });
                    }
                  for (const group of groups) await group.next();
                } finally {
                  for (const group of groups) await group.return(undefined);
                }
              } else {
                const results = [];
                for (const entry of entries) {
                  const run = await entry.page.evaluate(
                    ({ options, environment }) => Reflect.get(globalThis, 'testbed').summarizeRun(options, [], environment),
                    { options: { ...options, monitor: entry.variant.monitor }, environment: entry.environment },
                  );
                  results.push(run);
                  run.samples = entry.samples;
                  runs.push(run);
                }
                for (let iteration = 0; iteration < warmup + rounds; iteration++)
                  for (const index of rotation(entries.length, iteration)) {
                    const entry = entries[index];
                    if (!entry) throw Error('Missing measurement group');
                    await entry.page.bringToFront();
                    const sample = await entry.page.evaluate(
                      ({ options, iteration, phase }) => Reflect.get(globalThis, 'testbed').sampleRound(options, iteration, phase),
                      {
                        options: { ...options, monitor: entry.variant.monitor },
                        iteration,
                        phase: iteration < warmup ? 'warmup' : 'measurement',
                      },
                    );
                    entry.samples.push(sample);
                    order.push({ scene: definition.id, count, iteration, variant: entry.variant.label });
                  }
                for (const [index, entry] of entries.entries()) {
                  await entry.page.evaluate(() => Reflect.get(globalThis, 'testbed').close());
                  const run = await entry.page.evaluate(
                    ({ options, samples, environment }) => Reflect.get(globalThis, 'testbed').summarizeRun(options, samples, environment),
                    { options: { ...options, monitor: entry.variant.monitor }, samples: entry.samples, environment: entry.environment },
                  );
                  Object.assign(results[index], run);
                }
              }
              const groups = runs.slice(-entries.length);
              for (let index = 1; index < groups.length; index++) {
                const before = groups[0],
                  after = groups[index],
                  entry = entries[index];
                if (before && after && entry) comparisons.push(...compare(before.metrics, after.metrics));
              }
              console.log(JSON.stringify({ scene: definition.id, count, fileBytes, textShape, rounds }));
            } finally {
              for (const entry of entries) await entry.context.close();
            }
          }
    }
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
    errors.push(message);
    checks.push({ name: message, pass: false });
  }
  for (const run of runs) Object.assign(run, createTestRun(run));
  return { runs, checks, order, comparisons, errors };
});
