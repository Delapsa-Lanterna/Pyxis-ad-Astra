import { createBrowserHost } from '../host';
import { createScenario, scenarios, settled, until } from '../scenarios/registry';
import { eventListenerCount } from '../runtime/events';
import { exercise, recordAssertion, scrollList } from '../cases/operations';
import { summarizeRun } from './results';
import type { RoundResult, RunOptions } from '../contracts';

export const listCases = [
  ['csv', 50],
  ['csv', 300],
  ['csv', 2000],
  ['weapons', 30],
  ['weapons', 100],
  ['weapons', 800],
  ['wings', 30],
  ['wings', 100],
  ['wings', 800],
  ['hullmods', 30],
  ['hullmods', 100],
  ['hullmods', 800],
] as const;
export function createBenchmark(element: HTMLElement) {
  const host = createBrowserHost(element);
  let listenerBaseline: number | null = null;
  async function sampleRound(options: RunOptions, iteration: number, phase: RoundResult['phase']): Promise<RoundResult> {
    const result: RoundResult = { iteration, phase, metrics: {}, assertions: [] };
    const longTasks: PerformanceEntry[] = [];
    const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries()));
    observer.observe({ type: 'longtask' });
    try {
      const prepared = performance.now();
      const model = createScenario(options, `${options.scene}-${iteration}`);
      const mounted = await host.open(model, options.monitor);
      const definition = scenarios.find((scenario) => scenario.id === options.scene)!;
      await until(() => Boolean(element.querySelector(definition.selector)), definition.label);
      await settled();
      result.metrics.open = performance.now() - mounted;
      result.metrics.prepare = mounted - prepared;
      if (options.workload !== 'stress' && ['csv', 'weapons', 'wings', 'hullmods'].includes(options.scene)) {
        const panel = element.querySelector<HTMLElement>('.table-panel,.variant-picker-list,.variant-hullmod-list')!;
        await scrollList(
          panel,
          options.count,
          options.scene === 'csv' ? 24 : options.scene === 'hullmods' ? 36 : 78,
          options.scene === 'csv' ? '.csv-grid-row[data-row-key]' : '[data-entry-id]',
          result.metrics,
        );
        recordAssertion(result.assertions, '返回后首行节点保留', result.metrics.firstNodeRetained!, 1);
      }
      if (options.workload === 'resources') {
        await until(() => host.mediaStats.pending === 0, '资源交付');
        result.metrics.resourceBytes = host.mediaStats.activeBytes + host.mediaStats.idleBytes;
        const image = new Image();
        image.src = model.resourceDataUrl('graphics/resource-probe.svg');
        await image.decode();
        recordAssertion(result.assertions, '资源像素尺寸', image.naturalWidth, options.resourceSize);
      }
      await exercise(host, element, result.assertions, result.metrics);
      result.metrics.reads = model.reads;
      const close = performance.now();
      host.unmount();
      await settled();
      result.metrics.close = performance.now() - close;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      await host.close();
      await settled();
      result.metrics.listeners = eventListenerCount();
      listenerBaseline ??= eventListenerCount();
      recordAssertion(result.assertions, '监听数量稳定', eventListenerCount(), listenerBaseline);
      result.metrics.activeResources = host.mediaStats.activeEntries;
      recordAssertion(result.assertions, '所属保存会话释放', host.remainingSessions, 0);
      recordAssertion(result.assertions, '活跃资源释放', host.mediaStats.activeEntries, 0);
      recordAssertion(result.assertions, '资源请求释放', host.mediaStats.pending, 0);
      recordAssertion(result.assertions, '场景卸载', element.childElementCount, 0);
      observer.takeRecords().forEach((entry) => longTasks.push(entry));
      observer.disconnect();
      result.metrics.longTaskCount = longTasks.length;
      result.metrics.longTaskTime = longTasks.reduce((total, task) => total + task.duration, 0);
    }
    return result;
  }
  async function environment() {
    return {
      ...(await fetch('/environment').then((response) => response.json())),
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
      browser: navigator.userAgent,
      cache: 'fresh scene; shared module, font and idle image caches',
      profiler: false,
      operationVersion: 1,
    };
  }
  async function run(options: RunOptions, progress: (text: string) => void) {
    const samples: RoundResult[] = [];
    for (let iteration = 0; iteration < options.warmup + options.rounds; iteration++) {
      const phase = iteration < options.warmup ? 'warmup' : 'measurement';
      progress(`${options.scene} ${options.count} · ${phase} ${iteration + 1}/${options.warmup + options.rounds}`);
      samples.push(await sampleRound(options, iteration, phase));
      if (samples.at(-1)!.error) break;
    }
    return summarizeRun(options, samples, await environment());
  }
  return { host, sampleRound, run, environment, summarizeRun };
}
export type Benchmark = ReturnType<typeof createBenchmark>;
