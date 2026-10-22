export interface PerformanceFields {
  [key: string]: number | string | boolean | null | undefined;
}
export interface PerformanceSample {
  name: string;
  category: string;
  startedAt: number;
  duration: number;
  fields: PerformanceFields;
}
export const performanceMonitorAvailable = import.meta.env.VITE_PERFORMANCE_MONITOR !== '0';
export let performanceMonitorEnabled = false;
let sink: ((sample: PerformanceSample) => void) | null = null;

export function installPerformanceMonitor(next: (sample: PerformanceSample) => void): () => void {
  performanceMonitorEnabled = performanceMonitorAvailable;
  sink = next;
  return () => {
    if (sink !== next) return;
    sink = null;
    performanceMonitorEnabled = false;
  };
}

export function startPerformance(): number {
  return performanceMonitorEnabled ? performance.now() : 0;
}

export function recordPerformance(name: string, ms: number, fields: PerformanceFields = {}, startedAt?: number): void {
  if (performanceMonitorEnabled)
    sink!({ name, category: 'stage', startedAt: performance.timeOrigin + (startedAt ?? performance.now() - ms), duration: ms, fields });
}

export function beginPerformance(category: string, name: string, fields: PerformanceFields = {}): (status?: string) => void {
  const started = performance.now(),
    owner = sink;
  return (status = 'ok') =>
    sink === owner &&
    owner?.({
      name,
      category,
      startedAt: performance.timeOrigin + started,
      duration: performance.now() - started,
      fields: { ...fields, status },
    });
}
