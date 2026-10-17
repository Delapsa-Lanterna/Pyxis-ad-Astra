import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestWindow } from './managed.window';
const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/services/window.service', () => ({ requestNativeWindow: api.request }));
beforeEach(() => vi.clearAllMocks());
describe('managed window request delivery', () => {
  it('resolves only after the receiver accepts its registered request', async () => {
    let finish!: (value: unknown) => void;
    api.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const source = { kind: 'draft' as const, weapon: { id: 'w', description: '中文'.repeat(16000) } };
    let done = false;
    const opening = requestWindow({
      identity: { type: 'weapon-fire-preview', sessionId: 's', modRoot: 'M:/mod', id: 'w' },
      input: { kind: 'weapon-fire-preview', source },
      title: '预览',
      size: { width: 1120, height: 760, minWidth: 760, minHeight: 520 },
    }).then((result) => {
      done = true;
      return result;
    });
    await vi.waitFor(() => expect(api.request).toHaveBeenCalled());
    expect(done).toBe(false);
    expect(api.request.mock.lastCall![0].input.source).toEqual(source);
    finish({ label: 'managed-1', requestId: 9, status: 'accepted' });
    expect(await opening).toEqual({ label: 'managed-1', requestId: 9, status: 'accepted' });
  });
  it.each(['superseded', 'cancelled'] as const)('returns the %s terminal receipt', async (status) => {
    api.request.mockResolvedValue({ label: 'managed-1', requestId: 3, status });
    expect(
      await requestWindow({
        identity: { type: 'spec', sessionId: 's', modRoot: 'M:/mod', kind: 'ship', id: 'x' },
        title: 'x',
        input: { kind: 'editor', starsectorRoot: null },
        size: { width: 100, height: 100, minWidth: 10, minHeight: 10 },
      }),
    ).toMatchObject({ status });
  });
});
