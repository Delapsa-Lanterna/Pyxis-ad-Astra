import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openManagedWindow } from './managed.window';
const api = vi.hoisted(() => ({ open: vi.fn(), wait: vi.fn() }));
vi.mock('@/services/window.service', () => ({ openNativeManagedWindow: api.open, awaitNativeWindowRequest: api.wait }));
beforeEach(() => vi.clearAllMocks());
describe('managed window request delivery', () => {
  it('resolves only after the receiver accepts its registered request', async () => {
    api.open.mockResolvedValue({ label: 'managed-1', requestId: 9, reused: true });
    let finish!: (value: unknown) => void;
    api.wait.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const source = { kind: 'draft' as const, weapon: { id: 'w', description: '中文'.repeat(16000) } };
    let done = false;
    const opening = openManagedWindow({
      identity: { type: 'weapon-fire-preview', sessionId: 's', modRoot: 'M:/mod', id: 'w' },
      input: { kind: 'weapon-fire-preview', source },
      title: '预览',
      size: { width: 1120, height: 760, minWidth: 760, minHeight: 520 },
    }).then((result) => {
      done = true;
      return result;
    });
    await vi.waitFor(() => expect(api.wait).toHaveBeenCalledWith(9));
    expect(done).toBe(false);
    expect(api.open.mock.lastCall![0].input.source).toEqual(source);
    finish({ label: 'managed-1', requestId: 9, status: 'accepted' });
    expect(await opening).toEqual({ label: 'managed-1', requestId: 9, status: 'accepted' });
  });
  it.each(['superseded', 'cancelled'] as const)('returns the %s terminal receipt', async (status) => {
    api.open.mockResolvedValue({ label: 'managed-1', requestId: 3, reused: false });
    api.wait.mockResolvedValue({ label: 'managed-1', requestId: 3, status });
    expect(
      await openManagedWindow({
        identity: { type: 'spec', sessionId: 's', modRoot: 'M:/mod', kind: 'ship', id: 'x' },
        title: 'x',
        input: { kind: 'editor', starsectorRoot: null },
        size: { width: 100, height: 100, minWidth: 10, minHeight: 10 },
      }),
    ).toMatchObject({ status });
  });
});
