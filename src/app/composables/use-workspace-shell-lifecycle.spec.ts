import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/app/composables/use-window-close-state', () => ({ useWindowLifecycleActions: () => ({ requestClose: vi.fn() }) }));
import { useWorkspaceShellLifecycle } from './use-workspace-shell-lifecycle';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import type { AppFeedback } from '@/shared/types';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  events: vi.fn(),
  restore: vi.fn(),
  stopPersistence: vi.fn(),
  finishRestore: vi.fn(async () => {}),
  publish: vi.fn(async () => {}),
}));
vi.mock('@/orchestrators/project-sync.orchestrator', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/orchestrators/project-sync.orchestrator')>()),
  publishReferenceSources: mocks.publish,
}));
vi.mock('@/orchestrators/editor-window.orchestrator', () => ({ listenEditorSpecSaved: mocks.events }));
vi.mock('@/orchestrators/workspace-persistence.orchestrator', () => ({
  restorePersistedWorkspace: mocks.restore,
  watchWorkspacePersistence: () => ({ beginRestore: vi.fn(), finishRestore: mocks.finishRestore, stop: mocks.stopPersistence }),
}));
vi.mock('@/orchestrators/core-assets.orchestrator', () => ({ loadCoreFields: vi.fn() }));
vi.mock('@/services/app-log.service', () => ({ recordLogBestEffort: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.restore.mockResolvedValue(undefined);
  mocks.finishRestore.mockResolvedValue(undefined);
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
});
const feedback: AppFeedback = {
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  confirmDanger: vi.fn(),
  confirmWarning: vi.fn(),
  choose: vi.fn(async () => null),
};

function mountShell() {
  return mount({
    setup() {
      useWorkspaceShellLifecycle(feedback, async () => []);
      return () => null;
    },
  });
}

describe('workspace shell listener lifecycle', () => {
  it.each([
    ['active', false],
    ['active', true],
    ['released', false],
    ['released', true],
  ] as const)('holds closing until the %s shell finalizes its snapshot, rejected=%s', async (owner, rejected) => {
    let finish!: () => void, fail!: (error: Error) => void;
    const error = new Error('snapshot unavailable');
    mocks.finishRestore.mockReturnValueOnce(
      new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
    );
    const wrapper = mountShell();
    await flushPromises();
    expect(mocks.finishRestore).toHaveBeenCalledExactlyOnceWith(true);
    let settled = false;
    const closing = useSaveCommandStore()
      .settleCloseActions()
      .then(() => {
        settled = true;
      });
    await flushPromises();
    expect(settled).toBe(false);
    if (owner === 'released') wrapper.unmount();
    if (rejected) fail(error);
    else finish();
    await closing;
    await flushPromises();
    expect(settled).toBe(true);
    expect(feedback.error).toHaveBeenCalledTimes(rejected && owner === 'active' ? 1 : 0);
    if (rejected && owner === 'active') expect(feedback.error).toHaveBeenCalledWith(error, '保存工作区状态失败');
    if (owner === 'active') wrapper.unmount();
    expect(mocks.stopPersistence).toHaveBeenCalledOnce();
  });
  it.each(['restore-error', 'released'] as const)('finishes without persisting a %s restore', async (stage) => {
    let finish!: () => void, fail!: (error: Error) => void;
    const error = new Error('restore unavailable');
    mocks.restore.mockReturnValueOnce(
      new Promise<void>((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
    );
    const wrapper = mountShell();
    await flushPromises();
    if (stage === 'released') {
      wrapper.unmount();
      finish();
    } else fail(error);
    await flushPromises();
    expect(mocks.finishRestore).toHaveBeenCalledExactlyOnceWith(false);
    expect(feedback.error).toHaveBeenCalledTimes(stage === 'restore-error' ? 1 : 0);
    if (stage === 'restore-error') wrapper.unmount();
  });

  it('publishes changed reference sequences and releases the shell after startup', async () => {
    mocks.restore.mockImplementation(async () => {});
    const wrapper = mountShell();
    await flushPromises();
    const workspace = useWorkspaceStore();
    const project = useProjectStore();
    for (const id of ['atlas', 'beacon', 'comet']) {
      const modRoot = `M:/${id}`;
      workspace.registerMod({ modRoot, displayName: id, version: '', status: 'ready' });
      const manifest = sessionUpdateFixture(id, modRoot).projection.manifest;
      project.registerProjectManifest({ ...manifest, modInfo: { id } });
    }
    const manifest = project.getManifest('M:/atlas')!;
    project.replaceProjectManifest({ ...manifest, modInfo: { id: 'atlas', dependencies: [{ id: 'beacon' }, { id: 'comet' }] } });
    await flushPromises();
    const beacon = { sessionId: 'beacon', modRoot: 'M:/beacon' };
    const comet = { sessionId: 'comet', modRoot: 'M:/comet' };
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith([beacon, comet]);
    workspace.setModReferenceable('M:/beacon', true);
    await flushPromises();
    expect(mocks.publish).toHaveBeenCalledTimes(1);
    workspace.moveMod('M:/comet', 'M:/beacon', false);
    await flushPromises();
    expect(mocks.publish).toHaveBeenLastCalledWith([comet, beacon]);
    workspace.setModReferenceable('M:/beacon', false);
    await flushPromises();
    expect(mocks.publish).toHaveBeenLastCalledWith([comet]);
    workspace.setModReferenceable('M:/beacon', undefined);
    await flushPromises();
    expect(mocks.publish).toHaveBeenLastCalledWith([comet, beacon]);
    project.replaceProjectManifest({ ...manifest, modInfo: { id: 'atlas' } });
    await flushPromises();
    expect(mocks.publish).toHaveBeenLastCalledWith([]);
    expect(mocks.publish).toHaveBeenCalledTimes(5);
    wrapper.unmount();
    await flushPromises();
    expect(mocks.restore).toHaveBeenCalledOnce();
    expect(mocks.stopPersistence).toHaveBeenCalledOnce();
  });
});
