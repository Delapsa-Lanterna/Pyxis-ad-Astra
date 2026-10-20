import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { darkTheme, lightTheme } from 'naive-ui/es/themes';
import type { AccentPreset, AppSettings, AppTheme, EditMode, LogLevel } from '@/shared/types';
import { ACCENT_PRESETS, createThemeColors } from '@/domain/settings/theme';
import { generalFontFamily } from '@/domain/settings/fonts';
import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { readCacheLimits } from '@/domain/cache-limits';
import { deepClone } from '@/shared/lib/starsector';
import type { CacheLimits } from '@/shared/types';
import {
  assertValidSettings,
  readAccent,
  readCustomAccent,
  readGeneralFont,
  readEditMode,
  readExpandFieldDescriptions,
  readImmersiveGameFont,
  readHistoryLimit,
  readLogRotationSizeMiB,
  readLogBackupCount,
  readLogLevel,
  readOptionalLogDirectory,
  readPreserveOriginalJson,
  readAllowCoreEditing,
  readTheme,
  normalizeHex,
} from '@/domain/settings/rules';

let initialSettings: AppSettings | null = null;

export function initializeSettingsStore(settings: AppSettings): void {
  assertValidSettings(settings);
  initialSettings = settings;
  initializeCacheLimits(settings.cacheLimits);
}

export const useSettingsStore = defineStore('settings', () => {
  if (!initialSettings) throw new Error('Settings store used before initialization');
  const themePreference = ref(readTheme(initialSettings.theme));
  const cacheLimits = ref(structuredClone(initialSettings.cacheLimits));
  const systemTheme = ref<AppTheme>('light');
  const theme = computed(() => themePreference.value ?? systemTheme.value);
  const accent = ref<AccentPreset>(readAccent(initialSettings.accent));
  const customAccent = ref(readCustomAccent(initialSettings.customAccent));
  const generalFont = ref(initialSettings.generalFont);
  const fontFamily = computed(() => generalFontFamily(generalFont.value));
  const fileHistoryLimit = ref(initialSettings.fileHistoryLimit);
  const editHistoryLimit = ref(initialSettings.editHistoryLimit);
  const logRotationSizeMiB = ref(initialSettings.logRotationSizeMiB);
  const logBackupCount = ref(initialSettings.logBackupCount);
  const editMode = ref<EditMode>(readEditMode(initialSettings.editMode));
  const expandFieldDescriptions = ref(initialSettings.expandFieldDescriptions);
  const immersiveGameFont = ref(initialSettings.immersiveGameFont);
  const preserveOriginalJson = ref(readPreserveOriginalJson(initialSettings.preserveOriginalJson));
  const allowCoreEditing = ref(readAllowCoreEditing(initialSettings.allowCoreEditing));
  const savedCoreEditing = ref(allowCoreEditing.value);
  const canEditCore = computed(() => allowCoreEditing.value && savedCoreEditing.value);
  const starsectorRoot = ref(initialSettings.starsectorRoot);
  const logDirectory = ref(readOptionalLogDirectory(initialSettings.logDirectory));
  const logLevel = ref<LogLevel>(readLogLevel(initialSettings.logLevel));
  const naiveTheme = computed(() => (theme.value === 'dark' ? darkTheme : lightTheme));
  const isDark = computed(() => theme.value === 'dark');
  const isPlainEditMode = computed(() => editMode.value === 'plain');
  const activeAccentHex = computed(() => {
    if (accent.value === 'custom') return customAccent.value;
    const preset = ACCENT_PRESETS.find((item) => item.value === accent.value);
    if (!preset) throw new Error(`Invalid app accent: ${accent.value}`);
    return preset.hex;
  });
  const themeColors = computed(() => createThemeColors(activeAccentHex.value, theme.value));

  function setTheme(nextTheme: AppTheme) {
    themePreference.value = nextTheme;
  }

  function setSystemTheme(nextTheme: AppTheme) {
    systemTheme.value = nextTheme;
  }

  function toggleTheme() {
    setTheme(theme.value === 'dark' ? 'light' : 'dark');
  }

  function setAccent(nextAccent: AccentPreset) {
    accent.value = nextAccent;
  }

  function setCustomAccent(value: string): boolean {
    const normalized = normalizeHex(value);
    if (!normalized) return false;
    customAccent.value = normalized;
    accent.value = 'custom';
    return true;
  }

  function setFileHistoryLimit(limit: number) {
    fileHistoryLimit.value = readHistoryLimit(limit);
  }

  function setCacheLimit<K extends keyof CacheLimits>(section: K, key: keyof CacheLimits[K], value: number) {
    const next = deepClone(cacheLimits.value);
    Object.assign(next[section], { [key]: value });
    cacheLimits.value = readCacheLimits(next);
  }

  function setEditHistoryLimit(limit: number) {
    editHistoryLimit.value = readHistoryLimit(limit);
  }

  function setLogRotationSizeMiB(size: number) {
    logRotationSizeMiB.value = readLogRotationSizeMiB(size);
  }

  function setLogBackupCount(count: number) {
    logBackupCount.value = readLogBackupCount(count);
  }

  function setEditMode(mode: EditMode) {
    editMode.value = mode;
  }

  function setExpandFieldDescriptions(value: boolean) {
    expandFieldDescriptions.value = readExpandFieldDescriptions(value);
  }

  function setImmersiveGameFont(value: boolean) {
    immersiveGameFont.value = readImmersiveGameFont(value);
  }

  function setGeneralFont(value: string | null) {
    generalFont.value = readGeneralFont(value);
  }

  function setPreserveOriginalJson(enabled: boolean) {
    preserveOriginalJson.value = readPreserveOriginalJson(enabled);
  }

  function setAllowCoreEditing(enabled: boolean) {
    allowCoreEditing.value = readAllowCoreEditing(enabled);
  }

  function setStarsectorRoot(path: string | null) {
    starsectorRoot.value = path;
  }

  function setLogDirectory(path: string | null) {
    logDirectory.value = readOptionalLogDirectory(path);
  }

  function setLogLevel(level: LogLevel) {
    logLevel.value = level;
  }

  function settingsSnapshot() {
    return {
      cacheLimits: deepClone(cacheLimits.value),
      theme: themePreference.value,
      accent: accent.value,
      customAccent: customAccent.value,
      generalFont: generalFont.value,
      fileHistoryLimit: fileHistoryLimit.value,
      editHistoryLimit: editHistoryLimit.value,
      logRotationSizeMiB: logRotationSizeMiB.value,
      logBackupCount: logBackupCount.value,
      editMode: editMode.value,
      expandFieldDescriptions: expandFieldDescriptions.value,
      immersiveGameFont: immersiveGameFont.value,
      preserveOriginalJson: preserveOriginalJson.value,
      allowCoreEditing: allowCoreEditing.value,
      starsectorRoot: starsectorRoot.value,
      logDirectory: logDirectory.value,
      logLevel: logLevel.value,
    };
  }

  function replaceSettings(settings: AppSettings) {
    const nextCacheLimits = readCacheLimits(settings.cacheLimits);
    const nextGeneralFont = readGeneralFont(settings.generalFont);
    const nextExpandFieldDescriptions = readExpandFieldDescriptions(settings.expandFieldDescriptions);
    const nextImmersiveGameFont = readImmersiveGameFont(settings.immersiveGameFont);
    const nextFileHistoryLimit = readHistoryLimit(settings.fileHistoryLimit);
    const nextEditHistoryLimit = readHistoryLimit(settings.editHistoryLimit);
    const nextLogRotationSizeMiB = readLogRotationSizeMiB(settings.logRotationSizeMiB);
    const nextLogBackupCount = readLogBackupCount(settings.logBackupCount);
    themePreference.value = readTheme(settings.theme);
    accent.value = readAccent(settings.accent);
    customAccent.value = readCustomAccent(settings.customAccent);
    generalFont.value = nextGeneralFont;
    cacheLimits.value = structuredClone(nextCacheLimits);
    fileHistoryLimit.value = nextFileHistoryLimit;
    editHistoryLimit.value = nextEditHistoryLimit;
    logRotationSizeMiB.value = nextLogRotationSizeMiB;
    logBackupCount.value = nextLogBackupCount;
    editMode.value = readEditMode(settings.editMode);
    expandFieldDescriptions.value = nextExpandFieldDescriptions;
    immersiveGameFont.value = nextImmersiveGameFont;
    preserveOriginalJson.value = readPreserveOriginalJson(settings.preserveOriginalJson);
    allowCoreEditing.value = readAllowCoreEditing(settings.allowCoreEditing);
    savedCoreEditing.value = allowCoreEditing.value;
    starsectorRoot.value = settings.starsectorRoot;
    logDirectory.value = readOptionalLogDirectory(settings.logDirectory);
    logLevel.value = readLogLevel(settings.logLevel);
  }

  function confirmSavedSettings(settings: AppSettings) {
    savedCoreEditing.value = readAllowCoreEditing(settings.allowCoreEditing);
  }

  return {
    cacheLimits,
    setCacheLimit,
    accent,
    activeAccentHex,
    customAccent,
    generalFont,
    fontFamily,
    editMode,
    expandFieldDescriptions,
    immersiveGameFont,
    preserveOriginalJson,
    allowCoreEditing,
    canEditCore,
    confirmSavedSettings,
    fileHistoryLimit,
    editHistoryLimit,
    logRotationSizeMiB,
    logBackupCount,
    logDirectory,
    logLevel,
    isDark,
    isPlainEditMode,
    naiveTheme,
    starsectorRoot,
    theme,
    themeColors,
    setAccent,
    setCustomAccent,
    setGeneralFont,
    setEditMode,
    setExpandFieldDescriptions,
    setImmersiveGameFont,
    setPreserveOriginalJson,
    setAllowCoreEditing,
    setFileHistoryLimit,
    setEditHistoryLimit,
    setLogRotationSizeMiB,
    setLogBackupCount,
    setLogDirectory,
    setLogLevel,
    setStarsectorRoot,
    setTheme,
    setSystemTheme,
    toggleTheme,
    replaceSettings,
    settingsSnapshot,
  };
});
