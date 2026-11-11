import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { stat, readFile } from 'node:fs/promises';
import { TestWorkspace } from '../shared/test-workspace.mjs';
import { executable, cacheDirectory, desktopConfiguration, root } from './config.mjs';
import { fileHash, reserveReport, scriptFingerprints } from '../shared/test-output.mjs';
import { createTestRun } from '../shared/test-report.mjs';
import { startDesktop } from './runtime.mjs';
import { prepareSample } from './sample.mjs';
import { desktopCases } from './cases/registry.mjs';

const { values } = parseArgs({
  options: {
    suite: { type: 'string', default: 'sources' },
    exe: { type: 'string' },
    output: { type: 'string' },
    mod: { type: 'string' },
    game: { type: 'string' },
    soak: { type: 'string', default: '600' },
    rounds: { type: 'string', default: '30' },
    warmup: { type: 'string', default: '2' },
    count: { type: 'string', default: '50' },
    bytes: { type: 'string', default: '10485760' },
    shape: { type: 'string' },
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
  warmup: Number(values.warmup),
  count: Number(values.count),
  bytes: Number(values.bytes),
  shape: values.shape,
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
  const output = await reserveReport(options.output, join(cacheDirectory, 'reports'));
  /** @type {string[]} */
  const errors = [];
  /** @type {{name:string,milliseconds:number,pass:boolean}[]} */
  const checks = [];
  const runs = /** @type {import('../shared/test-report.mjs').TestRun[]} */ ([]);
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
      performanceMonitor: options.suite === 'workspace-opening',
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
    const scenario = desktopCases[options.suite];
    if (!scenario) throw Error('Unknown desktop suite: ' + options.suite);
    if (
      !['all', 'cold', 'warm'].includes(options.phase) ||
      !Number.isInteger(options.rounds) ||
      options.rounds < 1 ||
      !Number.isInteger(options.warmup) ||
      options.warmup < 0 ||
      !Number.isInteger(options.count) ||
      options.count < 1 ||
      !Number.isInteger(options.bytes) ||
      options.bytes < 4 ||
      (options.shape !== undefined && !['multiline', 'long-line'].includes(options.shape))
    )
      throw Error('Invalid desktop measurement parameters');
    metadata = {
      exe: options.exe,
      sha256: await fileHash(options.exe),
      bytes: (await stat(options.exe)).size,
      platform: process.platform,
      node: process.version,
      scriptSha256: await fileHash(resolve(root, 'scripts/desktop/run.mjs')),
      scripts: await scriptFingerprints(['scripts/desktop', 'scripts/shared']),
    };
    work = await TestWorkspace.create(join(cacheDirectory, 'workspaces'), 'run');
    const fixture = await prepareSample(work, options.suite === 'workspace-opening' ? undefined : options.mod, options.count);
    result = await scenario.run({ launch, close, fixture, check, options, artifacts: output.artifacts, runs });
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
    const afterClose = desktopCases[options.suite]?.afterClose;
    if (afterClose && resources.released && resources.desktops[0]?.pid) {
      try {
        const log = await readFile(join(output.artifacts, 'application-' + resources.desktops[0].pid + '.log'), 'utf8');
        await afterClose(log, check);
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
    for (const run of runs) {
      run.resources.released = resources.released;
      Object.assign(run, createTestRun(run));
    }
    const report = {
      kind: /** @type {const} */ ('desktop'),
      runs,
      suite: options.suite,
      options,
      ...metadata,
      ...result,
      checks,
      errors,
      resourcesReleased: resources.released,
      nativeDesktops: resources.desktops,
      pass: errors.length === 0 && resources.released && checks.every((check) => check.pass) && runs.every((run) => run.pass),
    };
    await output.finish(report);
    console.log(JSON.stringify({ output: output.path, pass: report.pass, checks: checks.length, resourcesReleased: resources.released }));
    process.exitCode = report.pass ? 0 : 1;
  }
}
