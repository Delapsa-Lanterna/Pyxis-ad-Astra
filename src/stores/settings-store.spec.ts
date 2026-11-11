import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { initializeSettingsStore, useSettingsStore } from './settings.store';
import { windowCacheLimits } from '@/shared/runtime/cache-limits';

const snapshot = createSettingsFixture({ theme: 'light' });

beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore({ ...snapshot });
});

describe('settings integer limits', () => {
  it('publishes, mirrors and resets the selected Java executable', () => {
    const settings = useSettingsStore();
    expect(settings.javaExecutable).toBeNull();
    settings.setJavaExecutable('G:/runtime/bin/java.exe');
    expect(settings.settingsSnapshot().javaExecutable).toBe('G:/runtime/bin/java.exe');
    settings.replaceSettings(createSettingsFixture({ javaExecutable: 'H:/runtime/bin/java.exe' }));
    expect(settings.javaExecutable).toBe('H:/runtime/bin/java.exe');
    settings.replaceSettings(createSettingsFixture());
    expect(settings.javaExecutable).toBeNull();
  });
  it.each(['success', 'info', 'warning', 'error'] as const)('validates and mirrors %s toast durations', (level) => {
    const settings = useSettingsStore();
    expect(settings.toastDurations).toEqual({ success: 5, info: 7, warning: 7, error: 0 });
    for (const seconds of [0, 3600]) {
      settings.setToastDuration(level, seconds);
      const saved = settings.settingsSnapshot();
      expect(saved.toastDurations[level]).toBe(seconds);
      settings.replaceSettings(saved);
      expect(settings.toastDurations[level]).toBe(seconds);
    }
    for (const seconds of [-1, 1.5, 3601, NaN, Infinity]) {
      const invalid = createSettingsFixture({ toastDurations: { ...snapshot.toastDurations, [level]: seconds } });
      expect(() => settings.setToastDuration(level, seconds)).toThrow();
      expect(() => settings.replaceSettings(invalid)).toThrow();
      expect(() => initializeSettingsStore(invalid)).toThrow();
      expect(settings.toastDurations[level]).toBe(3600);
    }
  });
  it.each(['success', 'info', 'warning', 'error'] as const)('persists and mirrors displayed Core %s feedback', (level) => {
    const settings = useSettingsStore();
    expect(settings.showCoreFeedback).toEqual({ success: true, info: true, warning: true, error: true });
    settings.setShowCoreFeedback(level, false);
    const saved = settings.settingsSnapshot();
    expect(saved.showCoreFeedback[level]).toBe(false);
    settings.replaceSettings(saved);
    expect(settings.showCoreFeedback[level]).toBe(false);
    const invalid = createSettingsFixture({
      showCoreFeedback: { ...snapshot.showCoreFeedback, [level]: 'true' as unknown as boolean },
    });
    expect(() => settings.replaceSettings(invalid)).toThrow();
    expect(settings.showCoreFeedback[level]).toBe(false);
  });
  it('validates and mirrors the editor warning preference', () => {
    const settings = useSettingsStore();
    expect(settings.ignoreEditorWarnings).toBe(false);
    settings.setIgnoreEditorWarnings(true);
    expect(settings.settingsSnapshot().ignoreEditorWarnings).toBe(true);
    settings.replaceSettings(createSettingsFixture());
    expect(settings.ignoreEditorWarnings).toBe(false);
    const invalid = 'true' as unknown as boolean;
    expect(() => settings.setIgnoreEditorWarnings(invalid)).toThrow();
    expect(() => settings.replaceSettings(createSettingsFixture({ ignoreEditorWarnings: invalid }))).toThrow();
    expect(() => initializeSettingsStore(createSettingsFixture({ ignoreEditorWarnings: invalid }))).toThrow();
  });
  it('publishes, mirrors and clears the immersive font directory', () => {
    const settings = useSettingsStore();
    expect(settings.immersiveFontDirectory).toBeNull();
    settings.setImmersiveFontDirectory('F:/fonts');
    expect(settings.settingsSnapshot().immersiveFontDirectory).toBe('F:/fonts');
    settings.replaceSettings(createSettingsFixture({ immersiveFontDirectory: 'F:/other' }));
    expect(settings.immersiveFontDirectory).toBe('F:/other');
    expect(() => settings.setImmersiveFontDirectory(' ')).toThrow();
    expect(() => settings.replaceSettings(createSettingsFixture({ immersiveFontDirectory: '' }))).toThrow();
    expect(settings.immersiveFontDirectory).toBe('F:/other');
    settings.setImmersiveFontDirectory(null);
    expect(settings.settingsSnapshot().immersiveFontDirectory).toBeNull();
  });
  it('defaults field descriptions closed and validates edits and mirrored snapshots', () => {
    const settings = useSettingsStore();
    expect(settings.expandFieldDescriptions).toBe(false);
    settings.setExpandFieldDescriptions(true);
    expect(settings.settingsSnapshot().expandFieldDescriptions).toBe(true);
    settings.replaceSettings(createSettingsFixture());
    expect(settings.expandFieldDescriptions).toBe(false);
    const invalid = 'true' as unknown as boolean;
    expect(() => initializeSettingsStore(createSettingsFixture({ expandFieldDescriptions: invalid }))).toThrow();
    expect(() => settings.setExpandFieldDescriptions(invalid)).toThrow();
    expect(() => settings.replaceSettings(createSettingsFixture({ theme: 'dark', expandFieldDescriptions: invalid }))).toThrow();
    expect(settings.theme).toBe('light');
    expect(settings.expandFieldDescriptions).toBe(false);
  });
  it('mirrors hidden cache limits while keeping the captured startup budget', () => {
    const settings = useSettingsStore(),
      next = createSettingsFixture();
    next.cacheLimits.thumbnails.MiB = 64;
    settings.replaceSettings(next);
    expect(settings.settingsSnapshot().cacheLimits.thumbnails.MiB).toBe(64);
    expect(windowCacheLimits().thumbnails.MiB).toBe(32);
    next.cacheLimits.decodedImages.entries = -1;
    expect(() => settings.replaceSettings(next)).toThrow();
    expect(settings.cacheLimits.thumbnails.MiB).toBe(64);
    expect(() => settings.setCacheLimit('thumbnails', 'MiB', 4097)).toThrow();
    expect(settings.cacheLimits.thumbnails.MiB).toBe(64);
  });
  it.each([
    ['interfaceFont', 'setInterfaceFont', 'interfaceFontFamily', "Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif"],
    [
      'fieldFont',
      'setFieldFont',
      'fieldFontFamily',
      "'Cascadia Mono', Consolas, 'Courier New', 'Microsoft YaHei UI', 'Microsoft YaHei', monospace",
    ],
    [
      'textEditorFont',
      'setTextEditorFont',
      'textEditorFontFamily',
      "'Cascadia Mono', Consolas, 'Courier New', 'Microsoft YaHei UI', 'Microsoft YaHei', monospace",
    ],
    ['canvasEditorFont', 'setCanvasEditorFont', 'canvasEditorFontFamily', 'sans-serif'],
  ] as const)('publishes and mirrors %s while preserving its default combination', (field, setter, family, defaults) => {
    const settings = useSettingsStore();
    expect(settings[field]).toBeNull();
    settings[setter]('Microsoft YaHei');
    expect(settings.settingsSnapshot()[field]).toBe('Microsoft YaHei');
    expect(settings[family]).toBe('"Microsoft YaHei", ' + defaults);
    settings.replaceSettings(createSettingsFixture({ [field]: 'Arial' }));
    expect(settings[field]).toBe('Arial');
    settings[setter](null);
    expect(settings[family]).toBe(defaults);
    for (const value of ['', ' ', 'Arial\n', 1]) {
      const font = value as string;
      expect(() => initializeSettingsStore(createSettingsFixture({ [field]: font }))).toThrow();
      expect(() => settings[setter](font)).toThrow();
      expect(() => settings.replaceSettings(createSettingsFixture({ [field]: font }))).toThrow();
      expect(settings[field]).toBeNull();
    }
  });
  it('validates and adopts the original-font switch through initialization and mirrors', () => {
    const settings = useSettingsStore();
    expect(settings.immersiveGameFont).toBe(true);
    settings.setImmersiveGameFont(false);
    expect(settings.settingsSnapshot().immersiveGameFont).toBe(false);
    settings.replaceSettings({ ...snapshot, immersiveGameFont: true });
    expect(settings.immersiveGameFont).toBe(true);
    expect(() => settings.replaceSettings({ ...snapshot, immersiveGameFont: 'true' as unknown as boolean })).toThrow();
    expect(settings.immersiveGameFont).toBe(true);
  });
  const limits = [
    ['fileHistoryLimit', 'setFileHistoryLimit', 1000],
    ['editHistoryLimit', 'setEditHistoryLimit', 1000],
    ['logRotationSizeMiB', 'setLogRotationSizeMiB', 1024],
    ['logBackupCount', 'setLogBackupCount', 20],
  ] as const;

  it.each(limits)('accepts the %s boundaries and publishes the complete snapshot', (field, setter, maximum) => {
    const settings = useSettingsStore();
    for (const value of [1, maximum]) {
      settings[setter](value);
      expect(settings.settingsSnapshot()).toEqual({ ...snapshot, [field]: value });
    }
  });

  it.each(limits)('rejects invalid %s at initialization, input and mirror boundaries', (field, setter, maximum) => {
    const settings = useSettingsStore();
    for (const value of [0, maximum + 1, -1, 1.5, NaN, Infinity]) {
      expect(() => initializeSettingsStore({ ...snapshot, [field]: value })).toThrow();
      expect(() => settings[setter](value)).toThrow();
      expect(() => settings.replaceSettings({ ...snapshot, theme: 'dark', [field]: value })).toThrow();
      expect(settings[field]).toBe(snapshot[field]);
      expect(settings.theme).toBe('light');
    }
  });

  it('adopts all four settings atomically from a window snapshot', () => {
    const settings = useSettingsStore();
    settings.replaceSettings({ ...snapshot, fileHistoryLimit: 40, editHistoryLimit: 400, logRotationSizeMiB: 12, logBackupCount: 3 });
    expect(settings.settingsSnapshot()).toMatchObject({
      fileHistoryLimit: 40,
      editHistoryLimit: 400,
      logRotationSizeMiB: 12,
      logBackupCount: 3,
    });
  });
});
