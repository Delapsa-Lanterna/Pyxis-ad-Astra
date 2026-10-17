import type { SaveAppSettingsPayload, AppSettings, SettingsSnapshot } from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';

export function readSettings(): Promise<SettingsSnapshot> {
  return invokeCommand('read_settings');
}

export function saveSettings(settings: AppSettings): Promise<SettingsSnapshot> {
  return invokeCommand('save_settings', { payload: { settings } satisfies SaveAppSettingsPayload });
}

export function querySystemFonts(): Promise<string[]> {
  return invokeCommand('query_system_fonts');
}
