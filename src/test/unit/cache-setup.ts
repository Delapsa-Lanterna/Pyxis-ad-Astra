import './console-setup';
import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { createSettingsFixture } from '../fixtures/settings';
import { vi } from 'vitest';
import { initializeWindowsPathCase } from '@/shared/lib/paths';
import { windowsPathCaseFixture } from '../fixtures/windows-path-case';
import type * as ProjectSyncServiceModule from '@/services/project-sync.service';

// Tests of content owners use an in-memory delivery fixture; native channel behavior is exercised by the sync tests.
vi.mock('@/services/project-sync.service', async (original) => ({
  ...(await original<typeof ProjectSyncServiceModule>()),
  registerSaveWindow: async () => {},
}));

initializeCacheLimits(createSettingsFixture().cacheLimits);
initializeWindowsPathCase(windowsPathCaseFixture);
