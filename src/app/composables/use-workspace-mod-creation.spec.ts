import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
const api = vi.hoisted(() => ({
  generation: 0,
  create: vi.fn(),
  open: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock('@/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({ gameOverview: { starsectorRoot: 'D:/game' }, getWorkspaceGeneration: () => api.generation }),
}));
vi.mock('@/orchestrators/mod-creation.orchestrator', () => ({ createModProject: api.create }));
vi.mock('@/orchestrators/workspace-opening.orchestrator', () => ({ openCreatedWorkspaceMod: api.open }));
vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({ success: api.success, info: api.info, error: api.error, warning: api.warning }),
}));
import { useWorkspaceModCreation } from './use-workspace-mod-creation';
const created = { modRoot: 'D:/game/mods/example', starsectorRoot: 'D:/game' };
beforeEach(() => {
  vi.resetAllMocks();
  api.generation = 1;
});
async function editor() {
  const model = useWorkspaceModCreation();
  await model.beginCreateMod();
  Object.assign(model.template, { id: 'example', name: 'Example', version: '1.0', gameVersion: '0.97a' });
  return model;
}
describe('workspace Mod creation lifetime', () => {
  it('delivers the disk creation result when the workspace closes during creation', async () => {
    const model = await editor();
    let finish!: (result: typeof created) => void;
    api.create.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const pending = model.submitCreateMod();
    api.generation++;
    finish(created);
    await expect(pending).resolves.toBe(true);
    expect(api.open).not.toHaveBeenCalled();
    expect(api.success).toHaveBeenCalledExactlyOnceWith('Mod 已创建');
    expect(model.saving.value).toBe(false);
  });
  it('opens the created result in its live workspace and delivers final feedback', async () => {
    const model = await editor();
    api.create.mockResolvedValue(created);
    api.open.mockResolvedValue({ modName: 'Example', warnings: [] });
    await model.submitCreateMod();
    await flushPromises();
    expect(api.open).toHaveBeenCalledExactlyOnceWith(created);
    expect(api.success).toHaveBeenCalledExactlyOnceWith('Mod 已创建并打开：Example');
  });
  it('delivers creation failure through the owning window feedback', async () => {
    const model = await editor();
    const failure = new Error('creation fixture failure');
    api.create.mockRejectedValue(failure);
    await expect(model.submitCreateMod()).resolves.toBe(false);
    expect(api.error).toHaveBeenCalledExactlyOnceWith(failure, '创建 Mod 失败');
    expect(api.open).not.toHaveBeenCalled();
    expect(model.saving.value).toBe(false);
  });
});
