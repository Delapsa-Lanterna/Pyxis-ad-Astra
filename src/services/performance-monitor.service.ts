import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { PerformanceBatch, PerformanceMonitorStatus } from '@/shared/types';

export function deliverPerformanceBatch(batch: PerformanceBatch): Promise<void> {
  return invokeCommand('performance_monitor_batch', { batch });
}
export function performanceMonitorReport(action: 'status' | 'reset' | 'export'): Promise<PerformanceMonitorStatus> {
  return invokeCommand('performance_monitor_report', { action });
}
