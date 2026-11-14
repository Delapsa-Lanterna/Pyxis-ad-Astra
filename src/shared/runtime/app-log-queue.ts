import { APP_LOG_LEVELS } from '@/shared/types';
import type { AppLogEntry, AppLogLevel } from '@/shared/types';
import { shallowRef } from 'vue';
import { errorDiagnosticOf } from '@/shared/lib/errors';
import { logFields, logIdentity } from '@/shared/lib/log-fields';
export const applicationLogError = shallowRef('');

export type RuntimeLogContext = Record<string, string | number | null | undefined>;
const contextProviders = new Set<() => RuntimeLogContext>();
export function setRuntimeErrorContext(provider: () => RuntimeLogContext) {
  contextProviders.add(provider);
  return () => contextProviders.delete(provider);
}
function runtimeContext(): RuntimeLogContext {
  const values: RuntimeLogContext = {};
  for (const provider of contextProviders)
    try {
      Object.assign(values, provider());
    } catch {
      /* Context collection cannot replace the original diagnostic. */
    }
  return values;
}

const LEVEL_RANK = Object.fromEntries(APP_LOG_LEVELS.map((level, index) => [level, index])) as Record<AppLogLevel, number>;

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
    if (pending.length + sending >= 4096) {
      stop('日志待写记录达到 4096 条，记录已停止', 1);
      return;
    }
    pending.push({
      ...entry,
      fields: {
        ...(entry.level === 'warning' || entry.level === 'error' ? logFields(runtimeContext()) : null),
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
  recordLazyLog('debug', code, fields);
}

export function infoLog(code: string, fields: () => Record<string, string>): void {
  recordLazyLog('info', code, fields);
}

function recordLazyLog(level: AppLogLevel, code: string, fields: () => Record<string, string>) {
  if (shouldQueueLog(level)) recordQueuedLog({ level, code, message: null, path: null, line: null, fields: fields() });
}

export function beginDebug(
  code: string,
  fields: () => Record<string, string>,
): ((status?: string, result?: unknown, error?: unknown) => void) | undefined {
  if (!shouldQueueLog('debug')) return;
  const context = fields(),
    started = performance.now();
  context.request ??= String(++intervalSequence);
  debugLog(`${code}.started`, () => context);
  return (status = 'completed', result, error) =>
    debugLog(`${code}.${status}`, () => {
      const diagnostic = error === undefined ? null : errorDiagnosticOf(error);
      return {
        ...context,
        ...logIdentity(result, 'result'),
        resultCount: String(Array.isArray(result) ? result.length : result == null ? 0 : 1),
        ...(diagnostic
          ? { errorCode: diagnostic.code, errorMessage: diagnostic.message, ...logIdentity(diagnostic.location, 'error') }
          : {}),
        durationMs: String(performance.now() - started),
      };
    });
}
