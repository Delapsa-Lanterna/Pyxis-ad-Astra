import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createNewModProject: vi.fn(),
}));

vi.mock('@/services/mod-creation.service', () => ({
  createNewModProject: mocks.createNewModProject,
}));

vi.mock('@/services/app-log.service', () => ({
  recordLogBestEffort: vi.fn(),
}));

import { createModProject } from './mod-creation.orchestrator';

const createdFixture = { modRoot: 'C:/games/mods/new_mod', starsectorRoot: 'D:/games/starsector' };
const requestFixture = {
  destination: { kind: 'game-mods' as const, starsectorRoot: 'D:/games/starsector' },
  template: { id: 'new_mod', name: 'New Mod', version: '1.0.0', gameVersion: '0.97a' },
};

describe('createModProject', () => {
  it('creates the mod through the service and returns the result', async () => {
    mocks.createNewModProject.mockResolvedValue(createdFixture);
    await expect(createModProject(requestFixture)).resolves.toEqual(createdFixture);
    expect(mocks.createNewModProject).toHaveBeenCalledWith(requestFixture);
  });

  it('propagates creation failures', async () => {
    mocks.createNewModProject.mockRejectedValue(new Error('target exists'));
    await expect(createModProject(requestFixture)).rejects.toThrow('target exists');
  });
});
