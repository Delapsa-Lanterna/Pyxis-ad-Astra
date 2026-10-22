export const APP_LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const;
export type AppLogLevel = (typeof APP_LOG_LEVELS)[number];

export interface AppLogEntry {
  level: AppLogLevel;
  code: string | null;
  message: string | null;
  path: string | null;
  line: number | null;
  fields: Record<string, string> | null;
}

export interface AppLogStatus {
  path: string;
  sizeBytes: number;
  recording: 'active' | 'stopped' | 'uninitialized';
  level: AppLogLevel;
  lastError: string | null;
  dropped: number;
  pending: number;
}

export interface AppendAppLogsPayload {
  entries: AppLogEntry[];
}
