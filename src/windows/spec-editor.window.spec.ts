import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestWindow: vi.fn(async () => {}),
}));

vi.mock('@/windows/managed.window', () => ({
  requestWindow: mocks.requestWindow,
}));

import { openSpecEditorWindow } from './spec-editor.window';
import type { SpecEditorWindowRequest } from './spec-editor.window';
import type { ManagedWindowInput, WindowIdentity } from '@/shared/types/index';

interface ManagedWindowCall {
  identity: WindowIdentity;
  title: string;
  input: ManagedWindowInput;
  size: { height: number; minHeight: number; minWidth: number; width: number };
}

function firstWindowCall(): ManagedWindowCall {
  const calls = mocks.requestWindow.mock.calls as unknown as Array<[ManagedWindowCall]>;
  return calls[0]![0];
}

const baseRequest: SpecEditorWindowRequest = {
  kind: 'ship',
  sessionId: 's1',
  modRoot: 'C:/mods/alpha',
  id: 'XY',
  starsectorRoot: 'D:/games/starsector',
};

describe('openSpecEditorWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens a singleton editor window keyed by session, kind, mod root and id', async () => {
    await openSpecEditorWindow(baseRequest);
    expect(mocks.requestWindow).toHaveBeenCalledTimes(1);
    const request = firstWindowCall();
    expect(request.identity).toEqual({ type: 'spec', sessionId: 's1', kind: 'ship', modRoot: 'C:/mods/alpha', id: 'XY' });
    expect(request.title).toBe('舰船编辑器 - XY');
    expect(request.size).toMatchObject({ width: 1160, height: 760 });
    expect(request.input).toEqual({ kind: 'editor', starsectorRoot: 'D:/games/starsector' });
  });

  it('opens a distinct window after the same Mod target gets a new session', async () => {
    await openSpecEditorWindow(baseRequest);
    await openSpecEditorWindow({ ...baseRequest, sessionId: 's2' });
    const calls = mocks.requestWindow.mock.calls as unknown as Array<[ManagedWindowCall]>;
    expect(calls[0]![0].identity).not.toEqual(calls[1]![0].identity);
    expect(calls[1]![0].identity).toMatchObject({ sessionId: 's2' });
  });

  it('honors a custom title', async () => {
    await openSpecEditorWindow({ ...baseRequest, title: '自定义标题' });
    expect(firstWindowCall().title).toBe('自定义标题');
  });
});
