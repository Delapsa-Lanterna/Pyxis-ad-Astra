import type { EditorCase } from './cases/editors';
import type { createListCase } from './cases/lists';
import type { createImmersiveCase } from './cases/immersive';
import { summarizeRun } from './results';
import type { RoundResult, RunOptions } from '../contracts';
import { cases } from './cases/registry';
export function createBenchmark(element: HTMLElement) {
  let current: EditorCase | ReturnType<typeof createListCase> | ReturnType<typeof createImmersiveCase> | undefined,
    key = '';
  async function close() {
    try {
      await current?.close();
    } finally {
      current = undefined;
      key = '';
    }
  }
  async function prepare(options: RunOptions) {
    const next = JSON.stringify(options);
    if (key !== next) {
      await close();
      current = await cases[options.scene](element, options);
      key = next;
    }
    return current!;
  }
  async function preview(options: RunOptions) {
    await close();
    return (await prepare(options)).open();
  }
  async function openEditor(options: RunOptions) {
    const sample = (await prepare(options)) as EditorCase;
    await sample.open();
    return { label: sample.label, file: sample.file, openMilliseconds: sample.openMilliseconds };
  }
  async function sampleRound(options: RunOptions, iteration: number, phase: RoundResult['phase']) {
    try {
      const sample = await prepare(options);
      if ('label' in sample && !sample.label) await sample.open();
      return await sample.sample(iteration, phase);
    } catch (error) {
      return { iteration, phase, metrics: {}, assertions: [], error: error instanceof Error ? error.message : String(error) };
    }
  }
  async function environment() {
    const build = await fetch(new URL('environment', location.href)).then((response) => response.json());
    return {
      ...build,
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      browser: navigator.userAgent,
      cache: 'fresh sample; shared module, font and idle image caches',
      profiler: false,
      operationVersion: Number(build.operationVersion),
    };
  }
  async function run(options: RunOptions, progress: (message: string) => void) {
    const samples: RoundResult[] = [];
    try {
      for (let iteration = 0; iteration < options.warmup + options.rounds; iteration++) {
        const phase = iteration < options.warmup ? 'warmup' : 'measurement';
        progress(`${options.scene} · ${phase} ${iteration + 1}/${options.warmup + options.rounds}`);
        samples.push(await sampleRound(options, iteration, phase));
        if (samples.at(-1)!.error) break;
      }
    } finally {
      await close();
    }
    return summarizeRun(options, samples, await environment());
  }
  return {
    sampleRound,
    run,
    environment,
    summarizeRun,
    openEditor,
    queryEditor: () => (current as EditorCase).query(),
    preview,
    close,
    get host() {
      return current && ('host' in current ? current.host : current);
    },
  };
}
export type Benchmark = ReturnType<typeof createBenchmark>;
