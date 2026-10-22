import type { PerformanceSample } from '@/shared/runtime/performance';

export interface PerformanceBatch {
  samples: PerformanceSample[];
  overwritten: number;
  environment: { instance: string; version: string; width: number; height: number; dpr: number; supported: readonly string[] };
}
export interface PerformanceMonitorStatus {
  enabled: boolean;
  records: number;
  overwritten: number;
  startedAt: number;
  path: string;
  traceAvailable: boolean;
  traceState: 'idle' | 'starting' | 'recording' | 'finishing' | 'ready' | 'failed';
  traceSeconds: number;
  traceStartedAt: number;
  traceError: string;
}
