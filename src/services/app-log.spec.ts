import { flushPromises } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordLogBestEffort } from './app-log.service';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue(undefined);
});
describe('application log lifecycle', () => {
  it('contains a rejected log write at the best-effort owner', async () => {
    invoke.mockRejectedValue({ code: 'io.unexpected', message: 'disk error', location: null });
    expect(() =>
      recordLogBestEffort({ level: 'warning', code: 'demo', message: 'raw', path: null, line: null, fields: null }),
    ).not.toThrow();
    await flushPromises();
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
