import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import type { ManagedWindowContext } from '@/shared/types';
const api = vi.hoisted(() => ({
  listen: vi.fn(),
  request: vi.fn(),
  context: vi.fn(),
  accept: vi.fn(),
  fail: vi.fn(),
  startup: vi.fn(),
  bootstrap: vi.fn(),
}));
vi.mock('./tauri.events', () => ({ listenWindowEvent: api.listen }));
vi.mock('@/services/window.service', () => ({
  getNativeWindowBootstrap: api.bootstrap,
  getNativeWindowContext: api.context,
  getNativeWindowRequest: api.request,
  acceptNativeWindowRequest: api.accept,
  failNativeWindowRequest: api.fail,
  failNativeWindowStartup: api.startup,
}));
vi.mock('@/services/app-settings.service', () => ({
  readSettings: vi.fn(),
  publishSettingsSnapshot: vi.fn(),
}));
function request(id: number): ManagedWindowContext {
  return {
    kind: 'weapon-fire-preview',
    identity: { type: 'weapon-fire-preview', sessionId: 's', modRoot: 'M:/mod', id: 'w' },
    input: { kind: 'weapon-fire-preview', source: { kind: 'draft', weapon: { id: 'w', value: id } } },
    label: 'managed-1',
    revision: id,
    receiverGeneration: 0,
    requestId: id,
    title: '预览',
  };
}
const stops: Array<() => void> = [];
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  api.accept.mockResolvedValue(true);
  api.request.mockResolvedValue(null);
  api.fail.mockResolvedValue(undefined);
  api.startup.mockResolvedValue(undefined);
});
afterEach(() => stops.splice(0).forEach((stop) => stop()));
describe('window context request reception', () => {
  it('installs the listener before reading and acknowledges state handoff', async () => {
    let completeListener!: (stop: () => void) => void;
    api.listen.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeListener = resolve;
        }),
    );
    api.request.mockResolvedValueOnce(request(1)).mockResolvedValue(null);
    api.context.mockResolvedValue(request(1));
    const runtime = await import('./window-context.window');
    let completeHandoff!: () => void;
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          completeHandoff = resolve;
        }),
    );
    stops.push(runtime.subscribeWindowRequests(handler, vi.fn()));
    expect(api.request).not.toHaveBeenCalled();
    completeListener(vi.fn());
    await flushPromises();
    expect(handler).toHaveBeenCalledWith(request(1));
    expect(api.accept).not.toHaveBeenCalled();
    completeHandoff();
    await flushPromises();
    expect(api.accept).toHaveBeenCalledWith(1, 0);
    expect(runtime.managedWindowContext.value).toEqual(request(1));
  });
  it('drains a newer notification while the previous handoff is pending', async () => {
    let notify!: () => Promise<void>;
    api.listen.mockImplementation(async (_event, handler) => {
      notify = handler;
      return vi.fn();
    });
    api.request.mockResolvedValueOnce(request(1)).mockResolvedValueOnce(request(2));
    api.accept.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    api.context.mockResolvedValue(request(2));
    let first!: () => void;
    const handled: number[] = [];
    const runtime = await import('./window-context.window');
    stops.push(
      runtime.subscribeWindowRequests(async (r) => {
        handled.push(r.requestId);
        if (r.requestId === 1)
          await new Promise<void>((resolve) => {
            first = resolve;
          });
      }, vi.fn()),
    );
    await flushPromises();
    void notify();
    first();
    await flushPromises();
    expect(handled).toEqual([1, 2]);
    expect(runtime.managedWindowContext.value?.requestId).toBe(2);
  });
  it('reports failed handoff to the sender with its structured diagnostic', async () => {
    api.listen.mockResolvedValue(vi.fn());
    api.request.mockResolvedValueOnce(request(1));
    const runtime = await import('./window-context.window');
    const onError = vi.fn();
    stops.push(
      runtime.subscribeWindowRequests(() => {
        throw new Error('交接失败');
      }, onError),
    );
    await flushPromises();
    expect(api.fail).toHaveBeenCalledWith(1, 0, expect.objectContaining({ message: '交接失败' }));
    expect(api.accept).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
  it('releases a listener that completes after disposal', async () => {
    let finish!: (stop: () => void) => void;
    api.listen.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const runtime = await import('./window-context.window');
    const stop = runtime.subscribeWindowRequests(vi.fn(), vi.fn());
    stop();
    const unlisten = vi.fn();
    finish(unlisten);
    await flushPromises();
    expect(unlisten).toHaveBeenCalledOnce();
    expect(api.request).not.toHaveBeenCalled();
  });
  it('ignores a context read that finishes after disposal', async () => {
    api.listen.mockResolvedValue(vi.fn());
    api.request.mockResolvedValueOnce(request(1));
    let finish!: (r: ManagedWindowContext) => void;
    api.context.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const runtime = await import('./window-context.window');
    const stop = runtime.subscribeWindowRequests(vi.fn(), vi.fn());
    await flushPromises();
    stop();
    finish(request(1));
    await flushPromises();
    expect(runtime.managedWindowContext.value).toBeNull();
  });
  it('reports listener startup failure and settles the initial request', async () => {
    const error = new Error('监听失败');
    api.listen.mockRejectedValue(error);
    const runtime = await import('./window-context.window');
    const onError = vi.fn();
    stops.push(runtime.subscribeWindowRequests(vi.fn(), onError));
    await flushPromises();
    expect(onError).toHaveBeenCalledWith(error, 'managed-window-request-available');
    expect(api.startup).toHaveBeenCalledWith(expect.objectContaining({ message: '监听失败' }));
  });
  it('accepts only newer settings and identity revisions across bootstrap and notifications', async () => {
    api.bootstrap.mockResolvedValue({ kind: 'managed', context: request(4), restoring: false, modName: 'Fixture Mod' });
    const runtime = await import('./window-context.window');
    await runtime.initializeWindowContext();
    expect(runtime.windowModName.value).toBe('Fixture Mod');
    runtime.publishWindowContext(request(3));
    expect(runtime.managedWindowContext.value?.revision).toBe(4);
  });
});
