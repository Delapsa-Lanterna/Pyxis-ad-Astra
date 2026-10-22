import type { AppSettings } from '@/shared/types';

export function createSettingsFixture(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    performanceMonitorEnabled: false,
    cacheLimits: {
      mediaData: { entries: 2048, MiB: 64 },
      decodedImages: { entries: 1024, MiB: 96 },
      thumbnails: { entries: 2048, MiB: 32 },
      backendMedia: { entries: 512, MiB: 64 },
      queries: {
        'joint-edit-catalog': 16,
        'joint-edit-candidate': 128,
        'csv-table-window': 80,
        'csv-source-options': 240,
        'csv-row-preview': 400,
        'hull-references': 128,
        'entity-detail': 128,
        'entity-list': 128,
      },
      fonts: { glyphEntriesPerPage: 512 },
    },
    theme: null,
    accent: 'blue',
    customAccent: '#2563eb',
    generalFont: null,
    fileHistoryLimit: 20,
    editHistoryLimit: 250,
    logRotationSizeMiB: 5,
    logBackupCount: 1,
    editMode: 'smart',
    expandFieldDescriptions: false,
    immersiveGameFont: true,
    preserveOriginalJson: true,
    allowCoreEditing: false,
    starsectorRoot: null,
    logDirectory: null,
    logLevel: 'info',
    ...overrides,
  };
}
