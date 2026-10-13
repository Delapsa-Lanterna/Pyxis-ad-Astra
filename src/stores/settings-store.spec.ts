import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppSettings } from '@/shared/types';
import { initializeSettingsStore, useSettingsStore } from './settings.store';

const snapshot: AppSettings = {
  theme: 'light',
  accent: 'blue',
  customAccent: '#2563eb',
  fileHistoryLimit: 20,
  editHistoryLimit: 250,
  logRotationSizeMiB: 5,
  logBackupCount: 1,
  editMode: 'smart',
  starsectorRoot: null,
  logDirectory: null,
  logLevel: 'info',
};

beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore({ ...snapshot });
});

describe('settings integer limits', () => {
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
      expect(settings.settingsSnapshot()).toEqual({ ...snapshot, [field]: value, preserveOriginalJson: true, allowCoreEditing: false });
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
