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
  it('publishes and mirrors a general font while preserving the default combination', () => {
    const settings = useSettingsStore();
    expect(settings.generalFont).toBeNull();
    settings.setGeneralFont('Microsoft YaHei');
    expect(settings.settingsSnapshot().generalFont).toBe('Microsoft YaHei');
    expect(settings.fontFamily).toBe("\"Microsoft YaHei\", Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif");
    settings.replaceSettings(createSettingsFixture({ generalFont: 'Arial' }));
    expect(settings.generalFont).toBe('Arial');
    settings.setGeneralFont(null);
    expect(settings.fontFamily).toBe("Inter, 'Segoe UI', 'Microsoft YaHei', sans-serif");
    for (const value of ['', ' ', 'Arial\n', 1]) {
      const generalFont = value as string;
      expect(() => initializeSettingsStore(createSettingsFixture({ generalFont }))).toThrow();
      expect(() => settings.setGeneralFont(generalFont)).toThrow();
      expect(() => settings.replaceSettings(createSettingsFixture({ generalFont }))).toThrow();
      expect(settings.generalFont).toBeNull();
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
