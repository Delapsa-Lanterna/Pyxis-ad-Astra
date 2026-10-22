import type { Pinia } from 'pinia';
import { shallowRef } from 'vue';
import {
  beginPerformance,
  installPerformanceMonitor,
  performanceMonitorAvailable,
  type PerformanceSample,
} from '@/shared/runtime/performance';
import { deliverPerformanceBatch, performanceMonitorReport } from '@/services/performance-monitor.service';
import { errorMessageOf } from '@/shared/lib/errors';

export const performanceMonitorError = shallowRef('');
interface LongAnimationFrame extends PerformanceEntry {
  blockingDuration: number;
  renderStart: number;
  styleAndLayoutStart: number;
}
export function retainPerformanceMonitorError(error: unknown): void {
  performanceMonitorError.value = errorMessageOf(error);
}
let flush: (() => Promise<void>) | null = null;
export function flushPerformanceMonitor(): Promise<void> | undefined {
  return flush?.();
}

export function startPerformanceMonitor(pinia: Pinia, enabled: boolean): (() => void) | undefined {
  if (!enabled || !performanceMonitorAvailable) return;
  let samples: PerformanceSample[] = [],
    active = true,
    overwritten = 0,
    pending: Promise<void> | null = null;
  const environment = {
    instance: crypto.randomUUID(),
    version: __APP_VERSION__,
    width: innerWidth,
    height: innerHeight,
    dpr: devicePixelRatio,
    supported: PerformanceObserver.supportedEntryTypes,
  };
  const stop = installPerformanceMonitor((sample) => {
    if (samples.length === 2048) {
      samples.shift();
      overwritten++;
    }
    samples.push(sample);
  });
  const actions: (() => void)[] = [];
  pinia.use(({ store }) => {
    if (!active) return;
    actions.push(
      store.$onAction(({ name, after, onError }) => {
        const finish = beginPerformance('action', `${store.$id}.${name}`);
        after(() => finish());
        onError(() => finish('error'));
      }),
    );
  });
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const isLongFrame = entry.entryType === 'long-animation-frame',
        frame = isLongFrame ? (entry as LongAnimationFrame) : null;
      samples.push({
        name: entry.name,
        category: entry.entryType,
        startedAt: performance.timeOrigin + entry.startTime,
        duration: entry.duration,
        fields: frame
          ? {
              blockingDuration: frame.blockingDuration,
              renderStart: frame.renderStart,
              styleAndLayoutStart: frame.styleAndLayoutStart,
            }
          : {},
      });
    }
    if (samples.length > 2048) {
      overwritten += samples.length - 2048;
      samples = samples.slice(-2048);
    }
  });
  for (const type of ['event', 'longtask', 'long-animation-frame'])
    if (environment.supported.includes(type)) observer.observe({ type, buffered: true });
  flush = () => {
    if (pending) return pending;
    pending = (async () => {
      while (samples.length || overwritten) {
        const batch = samples.splice(0, 512),
          dropped = overwritten;
        overwritten = 0;
        try {
          await deliverPerformanceBatch({
            samples: batch,
            overwritten: dropped,
            environment: { ...environment, width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          });
        } catch (error) {
          samples = [...batch, ...samples];
          overwritten += dropped;
          if (samples.length > 2048) {
            overwritten += samples.length - 2048;
            samples = samples.slice(-2048);
          }
          retainPerformanceMonitorError(error);
          throw error;
        }
      }
      performanceMonitorError.value = '';
    })().finally(() => {
      pending = null;
    });
    return pending;
  };
  const timer = setInterval(() => {
    void flush!().catch(retainPerformanceMonitorError);
  }, 1000);
  const release = () => {
    active = false;
    clearInterval(timer);
    observer.disconnect();
    actions.forEach((release) => release());
    stop();
    flush = null;
    window.removeEventListener('pagehide', release);
  };
  window.addEventListener('pagehide', release, { once: true });
  return release;
}

export async function controlPerformanceMonitor(action: 'status' | 'reset' | 'export' | 'traceStart' | 'traceStop', traceSeconds?: number) {
  await flushPerformanceMonitor();
  return performanceMonitorReport(action, traceSeconds);
}
