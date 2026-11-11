import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { darkTheme, lightTheme } from 'naive-ui/es/themes';
import type { AccentPreset, AppSettings, AppTheme, EditMode, FeedbackLevel, LogLevel } from '@/shared/types';
import { ACCENT_PRESETS, createThemeColors } from '@/domain/settings/theme';
import {
  DEFAULT_INTERFACE_FONT_FAMILY,
  DEFAULT_FIELD_FONT_FAMILY,
  DEFAULT_TEXT_EDITOR_FONT_FAMILY,
  DEFAULT_CANVAS_EDITOR_FONT_FAMILY,
  fontFamily,
} from '@/domain/settings/fonts';
import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { readCacheLimits } from '@/domain/cache-limits';
import { deepClone } from '@/shared/lib/starsector';
import type { CacheLimits } from '@/shared/types';
import {
  assertValidSettings,
  readAccent,
  readCustomAccent,
  readFont,
  readEditMode,
  readExpandFieldDescriptions,
  readIgnoreEditorWarnings,
  readImmersiveGameFont,
  readHistoryLimit,
  readLogRotationSizeMiB,
  readLogBackupCount,
  readLogLevel,
  readOptionalDirectory,
  readPreserveStructure,
  readAllowCoreEditing,
  readTheme,
  readToastDuration,
  readToastDurations,
  readShowCoreFeedback,
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
  const performanceMonitorEnabled = ref(initialSettings.performanceMonitorEnabled);
  function setPerformanceMonitorEnabled(enabled: boolean) {
    performanceMonitorEnabled.value = enabled;
  }
  const cacheLimits = ref(structuredClone(initialSettings.cacheLimits));
  const toastDurations = ref(structuredClone(initialSettings.toastDurations));
  const showCoreFeedback = ref(structuredClone(readShowCoreFeedback(initialSettings.showCoreFeedback)));
  const systemTheme = ref<AppTheme>('light');
  const theme = computed(() => themePreference.value ?? systemTheme.value);
  const accent = ref<AccentPreset>(readAccent(initialSettings.accent));
  const customAccent = ref(readCustomAccent(initialSettings.customAccent));
  const interfaceFont = ref(initialSettings.interfaceFont);
  const interfaceFontFamily = computed(() => fontFamily(interfaceFont.value, DEFAULT_INTERFACE_FONT_FAMILY));
  const fieldFont = ref(initialSettings.fieldFont);
  const fieldFontFamily = computed(() => fontFamily(fieldFont.value, DEFAULT_FIELD_FONT_FAMILY));
  const textEditorFont = ref(initialSettings.textEditorFont);
  const textEditorFontFamily = computed(() => fontFamily(textEditorFont.value, DEFAULT_TEXT_EDITOR_FONT_FAMILY));
  const canvasEditorFont = ref(initialSettings.canvasEditorFont);
  const canvasEditorFontFamily = computed(() => fontFamily(canvasEditorFont.value, DEFAULT_CANVAS_EDITOR_FONT_FAMILY));
  const fileHistoryLimit = ref(initialSettings.fileHistoryLimit);
  const editHistoryLimit = ref(initialSettings.editHistoryLimit);
  const logRotationSizeMiB = ref(initialSettings.logRotationSizeMiB);
  const logBackupCount = ref(initialSettings.logBackupCount);
  const editMode = ref<EditMode>(readEditMode(initialSettings.editMode));
  const expandFieldDescriptions = ref(initialSettings.expandFieldDescriptions);
  const ignoreEditorWarnings = ref(initialSettings.ignoreEditorWarnings);
  const immersiveGameFont = ref(initialSettings.immersiveGameFont);
  const immersiveFontDirectory = ref(initialSettings.immersiveFontDirectory);
  const javaExecutable = ref(initialSettings.javaExecutable);
  const preserveStructure = ref(readPreserveStructure(initialSettings.preserveStructure));
  const allowCoreEditing = ref(readAllowCoreEditing(initialSettings.allowCoreEditing));
  const savedCoreEditing = ref(allowCoreEditing.value);
  const canEditCore = computed(() => allowCoreEditing.value && savedCoreEditing.value);
  const watchFileChanges = ref(initialSettings.watchFileChanges);
  const starsectorRoot = ref(initialSettings.starsectorRoot);
  const savedStarsectorRoot = ref(initialSettings.starsectorRoot);
  const logDirectory = ref(readOptionalDirectory(initialSettings.logDirectory));
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

  function setToastDuration(level: FeedbackLevel, seconds: number) {
    toastDurations.value = { ...toastDurations.value, [level]: readToastDuration(seconds) };
  }

  function setShowCoreFeedback(level: FeedbackLevel, show: boolean) {
    showCoreFeedback.value = { ...showCoreFeedback.value, [level]: show };
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

  function setIgnoreEditorWarnings(value: boolean) {
    ignoreEditorWarnings.value = readIgnoreEditorWarnings(value);
  }

  function setExpandFieldDescriptions(value: boolean) {
    expandFieldDescriptions.value = readExpandFieldDescriptions(value);
  }

  function setImmersiveGameFont(value: boolean) {
    immersiveGameFont.value = readImmersiveGameFont(value);
  }

  function setInterfaceFont(value: string | null) {
    interfaceFont.value = readFont(value);
  }

  function setFieldFont(value: string | null) {
    fieldFont.value = readFont(value);
  }

  function setTextEditorFont(value: string | null) {
    textEditorFont.value = readFont(value);
  }

  function setCanvasEditorFont(value: string | null) {
    canvasEditorFont.value = readFont(value);
  }

  function setImmersiveFontDirectory(path: string | null) {
    immersiveFontDirectory.value = readOptionalDirectory(path);
  }
  function setJavaExecutable(path: string | null) {
    javaExecutable.value = readOptionalDirectory(path);
  }

  function setPreserveStructure(enabled: boolean) {
    preserveStructure.value = readPreserveStructure(enabled);
  }

  function setAllowCoreEditing(enabled: boolean) {
    allowCoreEditing.value = readAllowCoreEditing(enabled);
  }

  function setWatchFileChanges(enabled: boolean) {
    watchFileChanges.value = enabled;
  }

  function setStarsectorRoot(path: string | null) {
    starsectorRoot.value = path;
  }

  function setLogDirectory(path: string | null) {
    logDirectory.value = readOptionalDirectory(path);
  }

  function setLogLevel(level: LogLevel) {
    logLevel.value = level;
  }

  function settingsSnapshot() {
    return {
      performanceMonitorEnabled: performanceMonitorEnabled.value,
      cacheLimits: deepClone(cacheLimits.value),
      toastDurations: deepClone(toastDurations.value),
      showCoreFeedback: deepClone(showCoreFeedback.value),
      theme: themePreference.value,
      accent: accent.value,
      customAccent: customAccent.value,
      interfaceFont: interfaceFont.value,
      fieldFont: fieldFont.value,
      textEditorFont: textEditorFont.value,
      canvasEditorFont: canvasEditorFont.value,
      fileHistoryLimit: fileHistoryLimit.value,
      editHistoryLimit: editHistoryLimit.value,
      logRotationSizeMiB: logRotationSizeMiB.value,
      logBackupCount: logBackupCount.value,
      editMode: editMode.value,
      expandFieldDescriptions: expandFieldDescriptions.value,
      ignoreEditorWarnings: ignoreEditorWarnings.value,
      immersiveGameFont: immersiveGameFont.value,
      immersiveFontDirectory: immersiveFontDirectory.value,
      javaExecutable: javaExecutable.value,
      preserveStructure: preserveStructure.value,
      allowCoreEditing: allowCoreEditing.value,
      watchFileChanges: watchFileChanges.value,
      starsectorRoot: starsectorRoot.value,
      logDirectory: logDirectory.value,
      logLevel: logLevel.value,
    };
  }

  function replaceSettings(settings: AppSettings) {
    performanceMonitorEnabled.value = settings.performanceMonitorEnabled;
    const nextCacheLimits = readCacheLimits(settings.cacheLimits);
    const nextToastDurations = readToastDurations(settings.toastDurations);
    const nextShowCoreFeedback = readShowCoreFeedback(settings.showCoreFeedback);
    const nextInterfaceFont = readFont(settings.interfaceFont);
    const nextFieldFont = readFont(settings.fieldFont);
    const nextTextEditorFont = readFont(settings.textEditorFont);
    const nextCanvasEditorFont = readFont(settings.canvasEditorFont);
    const nextExpandFieldDescriptions = readExpandFieldDescriptions(settings.expandFieldDescriptions);
    const nextIgnoreEditorWarnings = readIgnoreEditorWarnings(settings.ignoreEditorWarnings);
    const nextImmersiveGameFont = readImmersiveGameFont(settings.immersiveGameFont);
    const nextImmersiveFontDirectory = readOptionalDirectory(settings.immersiveFontDirectory);
    const nextFileHistoryLimit = readHistoryLimit(settings.fileHistoryLimit);
    const nextEditHistoryLimit = readHistoryLimit(settings.editHistoryLimit);
    const nextLogRotationSizeMiB = readLogRotationSizeMiB(settings.logRotationSizeMiB);
    const nextLogBackupCount = readLogBackupCount(settings.logBackupCount);
    themePreference.value = readTheme(settings.theme);
    accent.value = readAccent(settings.accent);
    customAccent.value = readCustomAccent(settings.customAccent);
    interfaceFont.value = nextInterfaceFont;
    fieldFont.value = nextFieldFont;
    textEditorFont.value = nextTextEditorFont;
    canvasEditorFont.value = nextCanvasEditorFont;
    cacheLimits.value = structuredClone(nextCacheLimits);
    toastDurations.value = structuredClone(nextToastDurations);
    showCoreFeedback.value = structuredClone(nextShowCoreFeedback);
    fileHistoryLimit.value = nextFileHistoryLimit;
    editHistoryLimit.value = nextEditHistoryLimit;
    logRotationSizeMiB.value = nextLogRotationSizeMiB;
    logBackupCount.value = nextLogBackupCount;
    editMode.value = readEditMode(settings.editMode);
    expandFieldDescriptions.value = nextExpandFieldDescriptions;
    ignoreEditorWarnings.value = nextIgnoreEditorWarnings;
    immersiveGameFont.value = nextImmersiveGameFont;
    immersiveFontDirectory.value = nextImmersiveFontDirectory;
    javaExecutable.value = readOptionalDirectory(settings.javaExecutable);
    preserveStructure.value = readPreserveStructure(settings.preserveStructure);
    allowCoreEditing.value = readAllowCoreEditing(settings.allowCoreEditing);
    savedCoreEditing.value = allowCoreEditing.value;
    watchFileChanges.value = settings.watchFileChanges;
    starsectorRoot.value = settings.starsectorRoot;
    logDirectory.value = readOptionalDirectory(settings.logDirectory);
    logLevel.value = readLogLevel(settings.logLevel);
  }

  function confirmSavedSettings(settings: AppSettings) {
    savedStarsectorRoot.value = settings.starsectorRoot;
    savedCoreEditing.value = readAllowCoreEditing(settings.allowCoreEditing);
  }

  return {
    performanceMonitorEnabled,
    setPerformanceMonitorEnabled,
    cacheLimits,
    toastDurations,
    setToastDuration,
    showCoreFeedback,
    setShowCoreFeedback,
    setCacheLimit,
    accent,
    activeAccentHex,
    customAccent,
    interfaceFont,
    interfaceFontFamily,
    fieldFont,
    fieldFontFamily,
    textEditorFont,
    textEditorFontFamily,
    canvasEditorFont,
    canvasEditorFontFamily,
    editMode,
    expandFieldDescriptions,
    ignoreEditorWarnings,
    immersiveGameFont,
    immersiveFontDirectory,
    javaExecutable,
    setJavaExecutable,
    preserveStructure,
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
    savedStarsectorRoot,
    watchFileChanges,
    setWatchFileChanges,
    theme,
    themeColors,
    setAccent,
    setCustomAccent,
    setInterfaceFont,
    setFieldFont,
    setTextEditorFont,
    setCanvasEditorFont,
    setEditMode,
    setExpandFieldDescriptions,
    setIgnoreEditorWarnings,
    setImmersiveGameFont,
    setImmersiveFontDirectory,
    setPreserveStructure,
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
