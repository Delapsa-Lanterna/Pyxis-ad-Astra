import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { listenAppEvent } from './event.runtime';

const api = vi.hoisted(() => ({ listen: vi.fn(), stop: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: api.listen }));
beforeEach(() => {
  vi.resetAllMocks();
  api.listen.mockResolvedValue(api.stop);
});

afterEach(() => window.dispatchEvent(new Event('pagehide')));
describe('application event transport', () => {
  it.each(['registered', 'registering'] as const)('ends %s subscriptions before pagehide consumers release them', async (stage) => {
    let finish!: (stop: () => void) => void;
    if (stage === 'registering')
      api.listen.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
    const received = vi.fn(),
      failed = vi.fn();
    const pending = listenAppEvent('sample', received, failed);
    const stop = stage === 'registered' ? await pending : undefined;
    const release = () => stop?.();
    window.addEventListener('pagehide', release, { once: true });
    window.dispatchEvent(new Event('pagehide'));
    if (stage === 'registering') finish(api.stop);
    (await pending)();
    api.listen.mock.calls[0]![1]({ payload: 'late' });
    await flushPromises();
    expect(api.stop).toHaveBeenCalledTimes(0);
    expect(received).toHaveBeenCalledTimes(0);
    expect(failed).toHaveBeenCalledTimes(0);
  });
  it('ends delivery after normal scope release', async () => {
    const received = vi.fn(),
      failed = vi.fn();
    const stop = await listenAppEvent('sample', received, failed);
    stop();
    api.listen.mock.calls[0]![1]({ payload: 'late' });
    await flushPromises();
    expect(received).toHaveBeenCalledTimes(0);
    expect(api.stop).toHaveBeenCalledTimes(1);
  });
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
    stop();
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
