import { describe, it, expect, vi } from 'vitest';
import { openImmersiveEditorWindow } from './immersive-editor.window';
const mocks = vi.hoisted(() => ({ open: vi.fn(async () => {}) }));
vi.mock('@/windows/managed.window', () => ({ requestWindow: mocks.open }));
describe('immersive native request', () => {
  it('captures full identity, input and formal viewport constraints', async () => {
    const root = { sessionId: 's', modRoot: 'M:/mod', id: 'lasher', kind: 'ship' as const };
    await openImmersiveEditorWindow(root);
    expect(mocks.open).toHaveBeenCalledWith({
      identity: { type: 'immersive', ...root },
      title: '舰船沉浸式编辑器 - lasher',
      input: { kind: 'immersive-editor', rowKey: null },
      size: { width: 830, height: 700, minWidth: 430, minHeight: 480 },
    });
    await openImmersiveEditorWindow({ ...root, kind: 'weapon', id: 'chaingun' });
    expect(mocks.open).toHaveBeenLastCalledWith(
      expect.objectContaining({ size: { width: 430, height: 700, minWidth: 340, minHeight: 480 } }),
    );
    await openImmersiveEditorWindow({ ...root, kind: 'variant', id: 'aurora_Assault' });
    expect(mocks.open).toHaveBeenLastCalledWith(
      expect.objectContaining({
        identity: { type: 'immersive', sessionId: 's', modRoot: 'M:/mod', kind: 'variant', id: 'aurora_Assault' },
        size: { width: 1280, height: 720, minWidth: 960, minHeight: 640 },
      }),
    );
    await openImmersiveEditorWindow({ ...root, kind: 'wing', id: 'sarissa_wing' }, 'wings:row:3');
    expect(mocks.open).toHaveBeenLastCalledWith(
      expect.objectContaining({
        identity: { type: 'immersive', sessionId: 's', modRoot: 'M:/mod', kind: 'wing', id: 'sarissa_wing' },
        input: { kind: 'immersive-editor', rowKey: 'wings:row:3' },
        size: { width: 430, height: 700, minWidth: 340, minHeight: 480 },
      }),
    );
  });
});
