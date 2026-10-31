import type { CacheLimits } from './cache-limits.types.js';
import type { FeedbackLevel } from './feedback.types.js';

export const APP_THEMES = ['light', 'dark'] as const;
export type AppTheme = (typeof APP_THEMES)[number];

export const ACCENT_PRESET_VALUES = ['blue', 'orange', 'green', 'cyan', 'pink', 'purple', 'gray', 'custom'] as const;
export type AccentPreset = (typeof ACCENT_PRESET_VALUES)[number];

export const EDIT_MODES = ['plain', 'smart'] as const;
export type EditMode = (typeof EDIT_MODES)[number];

export const LOG_LEVELS = ['debug', 'info', 'warning', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type ToastDurations = Record<FeedbackLevel, number>;

export interface AppSettings {
  performanceMonitorEnabled: boolean;
  toastDurations: ToastDurations;
  cacheLimits: CacheLimits;
  theme: AppTheme | null;
  accent: AccentPreset;
  customAccent: string;
  generalFont: string | null;
  fileHistoryLimit: number;
  editHistoryLimit: number;
  logRotationSizeMiB: number;
  logBackupCount: number;
  editMode: EditMode;
  expandFieldDescriptions: boolean;
  immersiveGameFont: boolean;
  immersiveFontDirectory: string | null;
  preserveOriginalJson?: boolean;
  allowCoreEditing?: boolean;
  starsectorRoot: string | null;
  logDirectory: string | null;
  logLevel: LogLevel;
}

export interface SaveAppSettingsPayload {
  settings: AppSettings;
}

export interface SettingsSnapshot {
  performanceMonitorActive: boolean;
  revision: number;
  value: AppSettings;
}
