import { beforeEach, expect, it, vi } from 'vitest';
import { listenSettingsChanged } from './app-settings.service';

const listen = vi.hoisted(() => vi.fn());
vi.mock('@/shared/runtime/event.runtime', () => ({ listenAppEvent: listen }));
beforeEach(() => vi.resetAllMocks());

it('binds settings notifications and returns their registration task unchanged', async () => {
  const stop = vi.fn(),
    handler = vi.fn(),
    failed = vi.fn();
  const registration = Promise.resolve(stop);
  listen.mockReturnValue(registration);
  expect(listenSettingsChanged(handler, failed)).toBe(registration);
  expect(listen).toHaveBeenCalledExactlyOnceWith('app-settings-changed', handler, failed);
  expect(await registration).toBe(stop);
});
