import { createBrowserHost } from '../../host';
import { createScenario, performanceScenarios } from '../scenarios';
import { settled, until } from '../../timing';
import { eventListenerCount } from '../../runtime/events';
import { recordAssertion, scrollList } from './operations';
import { exerciseCsv } from './csv';
import { exercisePicker } from './pickers';
import type { RoundResult, RunOptions } from '../../contracts';

export function createListCase(element: HTMLElement, options: RunOptions) {
  const host = createBrowserHost(element);
  let listenerBaseline: number | null = null;
  async function sample(iteration: number, phase: RoundResult['phase']): Promise<RoundResult> {
    const result: RoundResult = { iteration, phase, metrics: {}, assertions: [] },
      longTasks: PerformanceEntry[] = [];
    const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries()));
    observer.observe({ type: 'longtask' });
    try {
      const prepared = performance.now(),
        model = createScenario(options, `${options.scene}-${iteration}`),
        mounted = await host.open(model, options.monitor);
      const definition = performanceScenarios.find((item) => item.id === options.scene)!;
      await until(() => Boolean(element.querySelector(definition.selector)), definition.label);
      await settled();
      result.metrics.open = performance.now() - mounted;
      result.metrics.prepare = mounted - prepared;
      if (options.workload !== 'stress') {
        await scrollList(
          element.querySelector<HTMLElement>('.table-panel,.variant-picker-list,.variant-hullmod-list')!,
          options.count,
          definition.rowHeight,
          definition.selector,
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
      if (options.scene === 'csv') await exerciseCsv(host, element, result.assertions, result.metrics);
      else await exercisePicker(element, result.assertions);
      result.metrics.reads = model.reads;
      const closed = performance.now();
      host.unmount();
      await settled();
      result.metrics.close = performance.now() - closed;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      await host.close();
      await settled();
      listenerBaseline ??= eventListenerCount();
      result.metrics.listeners = eventListenerCount();
      recordAssertion(result.assertions, '监听数量稳定', eventListenerCount(), listenerBaseline);
      recordAssertion(result.assertions, '所属保存会话释放', host.remainingSessions, 0);
      recordAssertion(result.assertions, '活跃资源释放', host.mediaStats.activeEntries, 0);
      recordAssertion(result.assertions, '资源请求释放', host.mediaStats.pending, 0);
      recordAssertion(result.assertions, '场景卸载', element.childElementCount, 0);
      observer.takeRecords().forEach((entry) => longTasks.push(entry));
      observer.disconnect();
      result.metrics.longTaskCount = longTasks.length;
      result.metrics.longTaskTime = longTasks.reduce((sum, task) => sum + task.duration, 0);
    }
    return result;
  }
  return { host, sample, open: () => host.open(createScenario(options), options.monitor), close: host.close };
}
