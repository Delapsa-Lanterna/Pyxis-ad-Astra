import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { listenAppEvent } from './event.runtime';

const api = vi.hoisted(() => ({ listen: vi.fn(), stop: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: api.listen }));
beforeEach(() => {
  vi.resetAllMocks();
  api.listen.mockResolvedValue(api.stop);
});

describe('application event transport', () => {
  it.each([undefined, 'target-window'])('forwards target %s and the original payload and release', async (target) => {
    const received = vi.fn();
    const failed = vi.fn();
    const stop = await listenAppEvent('fixture-event', received, failed, target);
    expect(api.listen).toHaveBeenCalledWith('fixture-event', expect.any(Function), { target });
    const payload = { value: 'fixture' };
    api.listen.mock.calls[0]![1]({ payload });
    await flushPromises();
    expect(received).toHaveBeenCalledExactlyOnceWith(payload);
    expect(failed).not.toHaveBeenCalled();
    expect(stop).toBe(api.stop);
    stop();
    expect(api.stop).toHaveBeenCalledOnce();
  });
  it.each(['sync', 'async'] as const)('delivers a %s handler failure with its event identity', async (kind) => {
    const error = new Error('handler fixture');
    const handler =
      kind === 'sync'
        ? () => {
            throw error;
          }
        : async () => {
            throw error;
          };
    const failed = vi.fn();
    await listenAppEvent('fixture-event', handler, failed);
    api.listen.mock.calls[0]![1]({ payload: null });
    await flushPromises();
    expect(failed).toHaveBeenCalledExactlyOnceWith(error, 'fixture-event');
  });
  it('propagates native registration failure to the caller', async () => {
    const error = new Error('registration fixture');
    api.listen.mockRejectedValue(error);
    const failed = vi.fn();
    await expect(listenAppEvent('fixture-event', vi.fn(), failed)).rejects.toBe(error);
    expect(failed).not.toHaveBeenCalled();
  });
});
