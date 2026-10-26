import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { createSettingsFixture } from '../fixtures/settings';

initializeCacheLimits(createSettingsFixture().cacheLimits);
