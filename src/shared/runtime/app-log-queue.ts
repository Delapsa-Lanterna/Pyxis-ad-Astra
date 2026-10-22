import type { AppLogEntry, AppLogLevel } from '@/shared/types';
import { shallowRef } from 'vue';
export const applicationLogError = shallowRef('');

const LEVEL_RANK: Record<AppLogLevel, number> = { debug: 0, info: 1, warning: 2, error: 3 };

export function createAppLogQueue() {
  let level: AppLogLevel = 'info',
    sequence = 0,
    instance = '',
    error = '',
    dropped = 0,
    sending = 0;
  let pending: AppLogEntry[] = [],
    timer: ReturnType<typeof setTimeout> | undefined,
    inFlight: Promise<void> | null = null;
  let deliver: ((entries: AppLogEntry[]) => Promise<void>) | null = null;
  let failed: (message: string, count: number) => void = () => {};
  const enabled = (value: AppLogLevel) => !error && LEVEL_RANK[value] >= LEVEL_RANK[level];
  function stop(message: string, failedBatch = 0) {
    if (error) {
      if (failedBatch) {
        dropped += failedBatch;
        failed(error, dropped);
      }
      return;
    }
    error = message;
    dropped = pending.length + failedBatch;
    pending = [];
    clearTimeout(timer);
    timer = undefined;
    failed(message, dropped);
  }
  function flush(): Promise<void> {
    if (inFlight) return inFlight;
    clearTimeout(timer);
    timer = undefined;
    if (!deliver || !pending.length || error) return Promise.resolve();
    inFlight = (async () => {
      while (pending.length && !error) {
        const batch = pending.splice(0, 64);
        sending = batch.length;
        try {
          await deliver!(batch);
        } catch (cause) {
          stop(cause instanceof Error ? cause.message : String(cause), batch.length);
        }
        sending = 0;
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }
  function record(entry: AppLogEntry) {
    if (!enabled(entry.level)) return;
    pending.push({
      ...entry,
      fields: {
        ...entry.fields,
        timestamp: new Date().toISOString(),
        window: (instance ||= crypto.randomUUID()),
        sequence: String(++sequence),
      },
    });
    if (pending.length >= 64) void flush();
    else
      timer ??= setTimeout(() => {
        timer = undefined;
        void flush();
      }, 100);
  }
  return {
    record,
    flush,
    stop,
    enabled,
    setLevel: (value: AppLogLevel) => {
      level = value;
    },
    install: (delivery: NonNullable<typeof deliver>, onFailure: typeof failed) => {
      deliver = delivery;
      failed = onFailure;
    },
    status: () => ({ pending: pending.length + sending, dropped, error, level }),
  };
}

export const appLogQueue = createAppLogQueue();
export const recordQueuedLog = appLogQueue.record;
export const shouldQueueLog = appLogQueue.enabled;
let intervalSequence = 0;

export function debugLog(code: string, fields: () => Record<string, string> = () => ({})): void {
  if (shouldQueueLog('debug')) recordQueuedLog({ level: 'debug', code, message: null, path: null, line: null, fields: fields() });
}

export function beginDebug(code: string, fields: () => Record<string, string>): ((status?: string) => void) | undefined {
  if (!shouldQueueLog('debug')) return;
  const context = fields(),
    started = performance.now();
  context.request ??= String(++intervalSequence);
  debugLog(`${code}.started`, () => context);
  return (status = 'completed') => debugLog(`${code}.${status}`, () => ({ ...context, durationMs: String(performance.now() - started) }));
}
