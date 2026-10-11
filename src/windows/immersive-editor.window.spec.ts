import { describe, it, expect, vi } from 'vitest';
import { openImmersiveEditorWindow } from './immersive-editor.window';
const mocks = vi.hoisted(() => ({ open: vi.fn(async () => {}) }));
vi.mock('@/windows/managed.window', () => ({ openManagedWindow: mocks.open }));
describe('immersive native request', () => {
  it('captures full identity, settings and formal viewport constraints', async () => {
    const root = { sessionId: 's', modRoot: 'M:/mod', id: 'lasher', kind: 'ship' as const };
    const settings = {
      theme: 'light' as const,
      accent: 'blue' as const,
      customAccent: '#3388cc',
      historyLimit: 20,
      editMode: 'smart' as const,
      starsectorRoot: null,
      logDirectory: null,
      logLevel: 'info' as const,
    };
    await openImmersiveEditorWindow(root, settings);
    expect(mocks.open).toHaveBeenCalledWith({
      identity: { type: 'immersive', ...root },
      title: '舰船沉浸式编辑器 - lasher',
      urlParams: { window: 'immersive-editor', ...root, settings: JSON.stringify(settings) },
      size: { width: 1160, height: 760, minWidth: 860, minHeight: 560 },
    });
  });
});
