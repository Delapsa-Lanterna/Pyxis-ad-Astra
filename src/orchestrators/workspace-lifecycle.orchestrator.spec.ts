import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { useProjectStore } from '@/stores/project.store';
import { closeWorkspaceRuntime, captureWorkspaceCloseTarget, acceptReleasedSessions } from './workspace-lifecycle.orchestrator';
import { useWorkspaceStore } from '@/stores/workspace.store';
const api = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock('@/services/core-assets.service', () => ({ invalidateCoreCacheForRoot: vi.fn(async () => {}) }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: vi.fn() }));
function register(id: string) {
  const update = sessionUpdateFixture(id, 'M:/' + id);
  useProjectStore().registerProjectManifest(update.projection.manifest);
  useWorkspaceStore().registerMod({ modRoot: 'M:/' + id, displayName: id, version: '', status: 'ready' });
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
describe('workspace close results', () => {
  it('accepts released sessions before the final receipt and preserves other sessions', async () => {
    register('alpha');
    register('beta');
    acceptReleasedSessions(['alpha']);
    acceptReleasedSessions(['alpha']);
    expect(useProjectStore().getSessionId('M:/alpha')).toBeNull();
    expect(useProjectStore().getSessionId('M:/beta')).toBe('beta');
    expect(useWorkspaceStore().loadedModList.map((item) => item.modRoot)).toEqual(['M:/beta']);
  });
  it.each(['closed', 'cancelled', 'failed'])('cleans precisely the released sessions for %s', async (status) => {
    register('alpha');
    register('beta');
    api.close.mockResolvedValue({
      status,
      destroyedWindows: ['managed-1'],
      releasedSessions: status === 'closed' ? ['alpha', 'beta'] : ['alpha'],
      diagnostic: status === 'failed' ? new Error('native close failed') : null,
    });
    const result = closeWorkspaceRuntime(captureWorkspaceCloseTarget(), api.close);
    if (status === 'failed') await expect(result).rejects.toThrow('native close failed');
    else expect(await result).toBe(status === 'closed');
    expect(api.close).toHaveBeenCalledWith({ kind: 'sessions', sessionIds: ['alpha', 'beta'] });
    expect(useProjectStore().getSessionId('M:/alpha')).toBeNull();
    expect(useProjectStore().getSessionId('M:/beta')).toBe(status === 'closed' ? null : 'beta');
  });
});
