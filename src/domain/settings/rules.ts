import { readCacheLimits } from '@/domain/cache-limits';
import {
  ACCENT_PRESET_VALUES,
  APP_THEMES,
  EDIT_MODES,
  LOG_LEVELS,
  type AccentPreset,
  type AppSettings,
  type AppTheme,
  type EditMode,
  type LogLevel,
} from '@/shared/types';

export const MAX_HISTORY_LIMIT = 1000;
export const MAX_LOG_ROTATION_SIZE_MIB = 1024;
export const MAX_LOG_BACKUP_COUNT = 20;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isAccentPreset(value: string | null): value is AccentPreset {
  return isSharedSettingValue(ACCENT_PRESET_VALUES, value);
}

function isSharedSettingValue<T extends readonly string[]>(values: T, value: string | null): value is T[number] {
  return Boolean(value && values.includes(value));
}

export function normalizeHex(value: string): string | null {
  const trimmed = value.trim();
  return HEX_COLOR_RE.test(trimmed) ? trimmed.toLowerCase() : null;
}

export function assertValidSettings(settings: AppSettings): void {
  if (typeof settings.performanceMonitorEnabled !== 'boolean') throw new Error('Invalid performance monitor setting');
  readTheme(settings.theme);
  readCacheLimits(settings.cacheLimits);
  readAccent(settings.accent);
  readCustomAccent(settings.customAccent);
  readGeneralFont(settings.generalFont);
  readHistoryLimit(settings.fileHistoryLimit);
  readHistoryLimit(settings.editHistoryLimit);
  readLogRotationSizeMiB(settings.logRotationSizeMiB);
  readLogBackupCount(settings.logBackupCount);
  readEditMode(settings.editMode);
  readExpandFieldDescriptions(settings.expandFieldDescriptions);
  readImmersiveGameFont(settings.immersiveGameFont);
  readOptionalDirectory(settings.immersiveFontDirectory);
  readPreserveOriginalJson(settings.preserveOriginalJson);
  readAllowCoreEditing(settings.allowCoreEditing);
  readLogLevel(settings.logLevel);
  readOptionalDirectory(settings.logDirectory);
}

export function readAllowCoreEditing(value: boolean | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new Error(`Invalid allow core editing setting: ${value}`);
  return value;
}

export function readTheme(value: AppTheme | null): AppTheme | null {
  if (value === null) return null;
  if (!isSharedSettingValue(APP_THEMES, value)) throw new Error(`Invalid app theme: ${value}`);
  return value;
}

export function readAccent(value: AccentPreset): AccentPreset {
  if (!isAccentPreset(value)) throw new Error(`Invalid app accent: ${value}`);
  return value;
}

export function readCustomAccent(value: string): string {
  const customAccent = normalizeHex(value);
  if (!customAccent) throw new Error(`Invalid custom accent: ${value}`);
  return customAccent;
}

export function readHistoryLimit(value: number): number {
  return readIntegerLimit(value, MAX_HISTORY_LIMIT, 'history limit');
}

export function readLogRotationSizeMiB(value: number): number {
  return readIntegerLimit(value, MAX_LOG_ROTATION_SIZE_MIB, 'log rotation size');
}

export function readLogBackupCount(value: number): number {
  return readIntegerLimit(value, MAX_LOG_BACKUP_COUNT, 'log backup count');
}

function readIntegerLimit(value: number, maximum: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}

export function readEditMode(value: EditMode): EditMode {
  if (!isSharedSettingValue(EDIT_MODES, value)) throw new Error(`Invalid edit mode: ${value}`);
  return value;
}

export function readImmersiveGameFont(value: boolean): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid original fonts setting: ${value}`);
  return value;
}

export function readExpandFieldDescriptions(value: boolean): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid expand field descriptions setting: ${value}`);
  return value;
}

export function readGeneralFont(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !value.trim() || /\p{Cc}/u.test(value)) throw new Error(`Invalid general font: ${value}`);
  return value;
}

export function readPreserveOriginalJson(value: boolean | undefined): boolean {
  if (value === undefined) return true;
  if (typeof value !== 'boolean') throw new Error(`Invalid preserve original JSON setting: ${value}`);
  return value;
}

export function readLogLevel(value: LogLevel): LogLevel {
  if (!isSharedSettingValue(LOG_LEVELS, value)) throw new Error(`Invalid log level: ${value}`);
  return value;
}

export function readOptionalDirectory(value: string | null): string | null {
  if (value === null) return null;
  if (!value.trim()) throw new Error('Invalid settings directory: blank');
  return value;
}
