import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { stat, readFile } from 'node:fs/promises';
import { TestWorkspace } from '../shared/test-workspace.mjs';
import { executable, cacheDirectory, desktopConfiguration, root } from './config.mjs';
import { fileHash, reserveReport } from './report.mjs';
import { startDesktop } from './runtime.mjs';
import { prepareSample } from './sample.mjs';
import { sourceSync } from './source-sync.mjs';
import { codeEditor } from './code-editor.mjs';
import { csvPerformance } from './csv-performance.mjs';
import { sourcePerformance } from './source-performance.mjs';

const { values } = parseArgs({
  options: {
    suite: { type: 'string', default: 'sources' },
    exe: { type: 'string' },
    output: { type: 'string' },
    mod: { type: 'string' },
    game: { type: 'string' },
    soak: { type: 'string', default: '600' },
    rounds: { type: 'string', default: '30' },
    count: { type: 'string', default: '50' },
    phase: { type: 'string', default: 'all' },
    screenshots: { type: 'boolean' },
    'isolated-desktop': { type: 'boolean' },
    'dry-run': { type: 'boolean' },
  },
});
const options = {
  suite: values.suite,
  exe: resolve(values.exe ?? executable),
  output: values.output,
  mod: values.mod ? resolve(values.mod) : undefined,
  game: values.game ? resolve(values.game) : undefined,
  soak: Number(values.soak),
  rounds: Number(values.rounds),
  count: Number(values.count),
  phase: values.phase,
  screenshots: values.screenshots ?? false,
  isolatedDesktop: values['isolated-desktop'] ?? false,
};
if (values['dry-run'])
  console.log(
    JSON.stringify({
      ...options,
      ...(await desktopConfiguration(options.isolatedDesktop)),
      cacheDirectory,
      normalClose: 'request_close(application)',
    }),
  );
else {
  const output = await reserveReport(options.output);
  /** @type {string[]} */
  const errors = [];
  /** @type {{name:string,milliseconds:number,pass:boolean}[]} */
  const checks = [];
  /** @type {Set<Awaited<ReturnType<typeof startDesktop>>>} */
  const applications = new Set();
  let work;
  let metadata = {};
  let result = {};
  /** @type {{released:boolean,desktops:{name:string,pid:number,released:boolean}[]}} */
  const resources = { released: true, desktops: [] };
  /** @param {string} name @param {() => Promise<void>} operation */
  async function check(name, operation) {
    const started = performance.now();
    let pass = false;
    try {
      await operation();
      pass = true;
    } finally {
      checks.push({ name, milliseconds: performance.now() - started, pass });
    }
  }
  async function launch() {
    const app = await startDesktop({
      exe: options.exe,
      isolatedDesktop: options.isolatedDesktop,
      artifacts: output.artifacts,
      errors,
      resources,
    });
    applications.add(app);
    return app;
  }
  /** @param {Awaited<ReturnType<typeof startDesktop>>} app */
  async function close(app) {
    await app.close();
    applications.delete(app);
  }
  try {
    if (!['sources', 'csv', 'source-performance', 'code-editor'].includes(options.suite))
      throw Error('Unknown desktop suite: ' + options.suite);
    if (['sources', 'code-editor'].includes(options.suite) && options.mod) throw Error('--mod applies to the CSV measurement suite');
    if (
      !['all', 'cold', 'warm'].includes(options.phase) ||
      !Number.isInteger(options.rounds) ||
      options.rounds < 1 ||
      !Number.isInteger(options.count) ||
      options.count < 1
    )
      throw Error('Invalid desktop measurement parameters');
    metadata = {
      exe: options.exe,
      sha256: await fileHash(options.exe),
      bytes: (await stat(options.exe)).size,
      platform: process.platform,
      node: process.version,
      scriptSha256: await fileHash(resolve(root, 'scripts/desktop/run.mjs')),
    };
    work = await TestWorkspace.create(join(cacheDirectory, 'workspaces'), 'run');
    const fixture = await prepareSample(work, options.mod, options.count);
    if (options.suite === 'sources') result = await sourceSync(await launch(), fixture, check, output.artifacts);
    else if (options.suite === 'code-editor') result = await codeEditor(await launch(), fixture, check, output.artifacts);
    else if (options.suite === 'source-performance') {
      if (!options.mod || !options.game || !Number.isFinite(options.soak) || options.soak < 0)
        throw Error('Source performance requires --mod, --game and a non-negative --soak');
      result = await sourcePerformance({
        app: await launch(),
        fixture: { ...fixture, game: options.game },
        check,
        options,
        artifacts: output.artifacts,
      });
    } else {
      const measurement = await csvPerformance({ launch, close, fixture, check, options, artifacts: output.artifacts });
      result = measurement;
      await check('CSV visible-field P95 <= 200ms', async () => {
        assert.ok(measurement.budget.pass, 'CSV visible-field P95 <= 200ms');
      });
    }
  } catch (error) {
    errors.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
  } finally {
    for (const app of applications) {
      try {
        await close(app);
      } catch (error) {
        resources.released = false;
        errors.push('Release: ' + String(error));
      }
    }
    if (options.suite === 'sources' && resources.released && resources.desktops[0]?.pid) {
      try {
        const log = await readFile(join(output.artifacts, 'application-' + resources.desktops[0].pid + '.log'), 'utf8');
        await check('Native WebView memory target reads back normal and low levels', async () => {
          assert.ok(log.includes('window.memory_target'));
          assert.match(log, /active=true level=0/);
          assert.match(log, /active=false level=1/);
          assert.ok(!log.includes('window.memory_target_failed'));
        });
      } catch (error) {
        errors.push(String(error));
      }
    }
    if (work && resources.released) {
      try {
        await work.close();
      } catch (error) {
        resources.released = false;
        errors.push('Workspace: ' + String(error));
      }
    }
    const report = {
      suite: options.suite,
      options,
      ...metadata,
      ...result,
      checks,
      errors,
      resourcesReleased: resources.released,
      nativeDesktops: resources.desktops,
      pass: errors.length === 0 && resources.released,
    };
    await output.finish(report);
    console.log(JSON.stringify({ output: output.path, pass: report.pass, checks: checks.length, resourcesReleased: resources.released }));
    process.exitCode = report.pass ? 0 : 1;
  }
}
