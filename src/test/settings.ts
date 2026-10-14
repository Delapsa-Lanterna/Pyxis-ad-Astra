import type { AppSettings } from '@/shared/types';

export function createSettingsFixture(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    theme: null,
    accent: 'blue',
    customAccent: '#2563eb',
    generalFont: null,
    fileHistoryLimit: 20,
    editHistoryLimit: 250,
    logRotationSizeMiB: 5,
    logBackupCount: 1,
    editMode: 'smart',
    immersiveGameFont: true,
    preserveOriginalJson: true,
    allowCoreEditing: false,
    starsectorRoot: null,
    logDirectory: null,
    logLevel: 'info',
    ...overrides,
  };
}
