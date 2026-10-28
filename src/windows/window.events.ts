export const WINDOW_EVENTS = {
  windowCloseIntent: 'window-lifecycle-close-requested',
  managedWindowReleased: 'managed-window-released',
  managedWindowRequestAvailable: 'managed-window-request-available',
  appSettingsChanged: 'app-settings-changed',
  appLogStopped: 'app-log-stopped',
} as const;

export type { CommittedWriteEvent } from '@/shared/types';

export type AppSettingsChangedEvent = import('@/shared/types').SettingsSnapshot;
