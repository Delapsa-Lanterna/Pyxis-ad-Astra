import { initializeCacheLimits } from '@/shared/runtime/cache-limits';
import { createSettingsFixture } from './settings';

initializeCacheLimits(createSettingsFixture().cacheLimits);
