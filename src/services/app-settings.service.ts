import type { SaveAppSettingsPayload, AppSettings, SettingsSnapshot } from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';
import { listenAppEvent, type AppEventHandler, type AppEventErrorHandler } from '@/shared/runtime/event.runtime';

const SETTINGS_CHANGED_EVENT = 'app-settings-changed';

export function readSettings(): Promise<SettingsSnapshot> {
  return invokeCommand('read_settings');
}

export function readDefaultSettings(): Promise<AppSettings> {
  return invokeCommand('read_default_settings');
}

export function saveSettings(settings: AppSettings): Promise<SettingsSnapshot> {
  return invokeCommand('save_settings', { payload: { settings } satisfies SaveAppSettingsPayload });
}

export function querySystemFonts(): Promise<string[]> {
  return invokeCommand('query_system_fonts');
}

export function listenSettingsChanged(handler: AppEventHandler<SettingsSnapshot>, onError: AppEventErrorHandler) {
  return listenAppEvent(SETTINGS_CHANGED_EVENT, handler, onError);
}
