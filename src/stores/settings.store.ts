import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { darkTheme, lightTheme } from 'naive-ui/es/themes';
import type { AccentPreset, AppSettings, AppTheme, EditMode, LogLevel } from '@/shared/types';
import { ACCENT_PRESETS, createThemeColors } from '@/domain/settings/theme';
import { generalFontFamily } from '@/domain/settings/fonts';
import {
  assertValidSettings,
  readAccent,
  readCustomAccent,
  readGeneralFont,
  readEditMode,
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
}

export const useSettingsStore = defineStore('settings', () => {
  if (!initialSettings) throw new Error('Settings store used before initialization');
  const themePreference = ref(readTheme(initialSettings.theme));
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
      theme: themePreference.value,
      accent: accent.value,
      customAccent: customAccent.value,
      generalFont: generalFont.value,
      fileHistoryLimit: fileHistoryLimit.value,
      editHistoryLimit: editHistoryLimit.value,
      logRotationSizeMiB: logRotationSizeMiB.value,
      logBackupCount: logBackupCount.value,
      editMode: editMode.value,
      immersiveGameFont: immersiveGameFont.value,
      preserveOriginalJson: preserveOriginalJson.value,
      allowCoreEditing: allowCoreEditing.value,
      starsectorRoot: starsectorRoot.value,
      logDirectory: logDirectory.value,
      logLevel: logLevel.value,
    };
  }

  function replaceSettings(settings: AppSettings) {
    const nextGeneralFont = readGeneralFont(settings.generalFont);
    const nextImmersiveGameFont = readImmersiveGameFont(settings.immersiveGameFont);
    const nextFileHistoryLimit = readHistoryLimit(settings.fileHistoryLimit);
    const nextEditHistoryLimit = readHistoryLimit(settings.editHistoryLimit);
    const nextLogRotationSizeMiB = readLogRotationSizeMiB(settings.logRotationSizeMiB);
    const nextLogBackupCount = readLogBackupCount(settings.logBackupCount);
    themePreference.value = readTheme(settings.theme);
    accent.value = readAccent(settings.accent);
    customAccent.value = readCustomAccent(settings.customAccent);
    generalFont.value = nextGeneralFont;
    fileHistoryLimit.value = nextFileHistoryLimit;
    editHistoryLimit.value = nextEditHistoryLimit;
    logRotationSizeMiB.value = nextLogRotationSizeMiB;
    logBackupCount.value = nextLogBackupCount;
    editMode.value = readEditMode(settings.editMode);
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
    accent,
    activeAccentHex,
    customAccent,
    generalFont,
    fontFamily,
    editMode,
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
