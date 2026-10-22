import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { performance } from 'node:perf_hooks';
import { runInNewContext } from 'node:vm';

/** @typedef {'debug' | 'info' | 'warning' | 'error'} LogLevel */
/** @typedef {{ level: LogLevel, code: string, message: null, path: null, line: null, fields: null }} LogEntry */
/** @typedef {{ record(entry: LogEntry): void, flush(): Promise<void>, setLevel(level: LogLevel): void,
 * install(deliver: () => Promise<void>, failed: () => void): void }} LogQueue */

/** @param {string} source @returns {unknown} */
const compile = (source) => {
  const context = { exports: {}, performance, crypto, setTimeout, clearTimeout, __logBenchmarkInvoke: invoke };
  runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.CommonJS },
    }).outputText,
    context,
  );
  return context.exports;
};
let calls = 0;
const invoke = async () => {
  calls++;
};
const reference = process.argv[2] ?? 'df3bebea346fb3992545fae5bed5ec2ba060c782';
const baselineSource = execFileSync('git', ['show', reference + ':src/services/app-log.service.ts'], { encoding: 'utf8' }).replace(
  /import \{ invokeCommand \}[^;]+;/,
  'const invokeCommand = globalThis.__logBenchmarkInvoke;',
);
const baseline = /** @type {{ recordLogBestEffort(entry: LogEntry): void }} */ (compile(baselineSource));
const current = /** @type {{ createAppLogQueue(): LogQueue }} */ (
  compile(
    (await readFile('src/shared/runtime/app-log-queue.ts', 'utf8')).replace(
      /import \{ shallowRef \}[^;]+;/,
      'const shallowRef = (value) => ({ value });',
    ),
  )
);
/** @param {LogLevel} level */
const entry = (level) => ({ level, code: 'fixture', message: null, path: null, line: null, fields: null });
/** @param {number[]} values */
const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted.at(-1),
    mean: sorted.reduce((a, b) => a + b, 0) / sorted.length,
    median: (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
};
/** @type {Record<'baseline' | 'info' | 'debug' | 'batch', number[]>} */
const samples = { baseline: [], info: [], debug: [], batch: [] };
for (let round = 0; round < 30; round++) {
  /** @type {Array<'baseline' | 'info' | 'debug'>} */
  const order = round % 2 ? ['debug', 'info', 'baseline'] : ['baseline', 'info', 'debug'];
  for (const mode of order) {
    const queue = current.createAppLogQueue();
    queue.setLevel(mode === 'debug' ? 'debug' : 'info');
    queue.install(
      async () => {
        const start = performance.now();
        await invoke();
        samples.batch.push(performance.now() - start);
      },
      () => {},
    );
    calls = 0;
    const started = performance.now();
    for (let index = 0; index < 1000; index++) {
      if (mode === 'baseline') baseline.recordLogBestEffort(entry('info'));
      else queue.record(entry(mode));
    }
    if (mode !== 'baseline') await queue.flush();
    samples[mode].push(performance.now() - started);
    if (calls !== (mode === 'baseline' ? 1000 : 16)) throw new Error('Unexpected delivery count');
  }
}
process.stdout.write(
  JSON.stringify(
    {
      environment: { node: process.version, platform: process.platform, architecture: process.arch },
      reference,
      boundary: '1000 records: frontend generation through resolved in-memory delivery; IPC, rendering and disk excluded',
      calls: { baseline: 1000, current: 16 },
      metrics: Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, summarize(values)])),
    },
    null,
    2,
  ) + '\n',
);
