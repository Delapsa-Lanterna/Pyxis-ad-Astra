import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import type { AppFeedback, ManagedWindowContext, WindowSaveMessage, WindowSaveReply, WindowSaveRequest } from '@/shared/types';
import { createFieldInputs } from '@/shared/runtime/field-inputs';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';
import { createModSaveCoordinator } from './mod-save.orchestrator';
const wire = vi.hoisted(() => ({
  label: 'main',
  context: { value: null as ManagedWindowContext | null },
  active: 'a',
  owners: ['main'],
  receivers: new Map<string, (message: WindowSaveMessage) => void>(),
  replies: new Map<number, { resolve: (value: WindowSaveReply) => void; reject: (error: unknown) => void }>(),
  sequence: 0,
  order: [] as string[],
}));
vi.mock('@/windows/current.window', () => ({ currentWindowLabel: () => wire.label }));
vi.mock('@/windows/window-context.window', () => ({ managedWindowContext: wire.context }));
vi.mock('@/stores/project.store', () => ({
  useProjectStore: () => ({ getManifest: (root: string) => ({ sessionId: root.slice(-1), modRoot: root }) }),
}));
vi.mock('@/stores/workspace.store', () => ({
  useWorkspaceStore: () => ({
    get activeManifest() {
      return { sessionId: wire.active, modRoot: 'M:/' + wire.active };
    },
  }),
}));
vi.mock('@/services/window.service', () => ({
  registerWindowSaveReceiver: vi.fn(async (receive: (message: WindowSaveMessage) => void) => {
    wire.receivers.set(wire.label, receive);
    return ++wire.sequence;
  }),
  unregisterWindowSaveReceiver: vi.fn(async () => {}),
  queryEditTargetOwners: vi.fn(async () => wire.owners),
  requestWindowSave: vi.fn(
    (receiver: string, request: WindowSaveRequest) =>
      new Promise<WindowSaveReply>((resolve, reject) => {
        const requestId = ++wire.sequence;
        wire.replies.set(requestId, { resolve, reject });
        wire.receivers.get(receiver)!({ requestId, receiverGeneration: 1, request });
      }),
  ),
  replyWindowSave: vi.fn(async (message: WindowSaveMessage, result: WindowSaveReply, diagnostic: unknown) => {
    const pending = wire.replies.get(message.requestId)!;
    wire.replies.delete(message.requestId);
    if (diagnostic) pending.reject(diagnostic);
    else pending.resolve(result);
  }),
}));
function feedback(): AppFeedback {
  return {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    choose: vi.fn(async () => null),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
  };
}
function editor(name: string, sessionId = 'a') {
  const targetKey = ref(name),
    dirty = ref(true),
    inputs = createFieldInputs(targetKey);
  const save = vi.fn<() => Promise<DocumentSaveResult>>(async () => {
    wire.order.push(name);
    dirty.value = false;
    return { status: 'saved', receipt: savedWriteFixture() };
  });
  const handle = {
    targetKey,
    modRoot: ref('M:/' + sessionId),
    saving: ref(false),
    waitForSave: async () => true,
    editing: {
      label: name,
      dirty,
      targets: ref([{ sessionId, modRoot: 'M:/' + sessionId, path: 'M:/' + sessionId + '/' + name }]),
      draftSession: { draftValue: ref({}), inputs },
      save,
    },
  };
  const release = useSaveCommandStore().registerSaveSession(handle);
  return { handle, save, dirty, inputs, targetKey, release };
}
beforeEach(() => {
  setActivePinia(createPinia());
  wire.label = 'main';
  wire.active = 'a';
  wire.context.value = null;
  wire.owners = ['main'];
  wire.order = [];
  wire.receivers.clear();
  wire.replies.clear();
  vi.clearAllMocks();
});
describe('Mod save coordination', () => {
  it('commits pending input and saves only the captured Mod editors', async () => {
    const own = editor('csv'),
      other = editor('json', 'b'),
      pending = ref(true);
    own.dirty.value = false;
    own.inputs.register({
      key: 'field',
      label: 'Field',
      dirty: pending,
      focus: vi.fn(),
      cancel: vi.fn(),
      commit: () => {
        pending.value = false;
        own.dirty.value = true;
        return null;
      },
    });
    const output = feedback(),
      coordinator = createModSaveCoordinator(output, () => false);
    await coordinator.save();
    expect(own.save).toHaveBeenCalledOnce();
    expect(other.save).not.toHaveBeenCalled();
    expect(output.success).toHaveBeenCalledWith('Mod 保存完成：已保存 1 项，取消 0 项，失败 0 项');
    coordinator.dispose();
  });
  it('continues after cancellation and failure and reports concrete outcomes', async () => {
    const cancelled = editor('a'),
      failed = editor('b'),
      saved = editor('c');
    cancelled.handle.editing.save = vi.fn(async () => ({ status: 'cancelled' as const }));
    failed.save.mockRejectedValueOnce(new Error('fixture failure'));
    const output = feedback(),
      coordinator = createModSaveCoordinator(output, () => false);
    await coordinator.save();
    expect(saved.save).toHaveBeenCalledOnce();
    expect(output.choose).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'warning', content: expect.stringContaining('已保存 1 项，取消 1 项，失败 1 项') }),
    );
    expect(vi.mocked(output.choose).mock.calls[0]![0].content).toContain('M:/a/b');
    coordinator.dispose();
  });
  it('saves the triggering child Mod before its main-window documents', async () => {
    const a = editor('a', 'a'),
      b = editor('main-b', 'b'),
      main = createModSaveCoordinator(feedback(), () => false);
    setActivePinia(createPinia());
    wire.label = 'child';
    wire.context.value = { identity: { type: 'file', sessionId: 'b', modRoot: 'M:/b', path: 'M:/b/file' } } as ManagedWindowContext;
    const child = editor('child-b', 'b'),
      coordinator = createModSaveCoordinator(feedback(), () => false);
    wire.owners = ['main', 'child'];
    await coordinator.save();
    expect(wire.order).toEqual(['child-b', 'main-b']);
    expect(a.save).not.toHaveBeenCalled();
    expect(b.save).toHaveBeenCalledOnce();
    expect(child.save).toHaveBeenCalledOnce();
    main.dispose();
    coordinator.dispose();
  });
  it('coalesces repeated triggers and queues different Mods with captured targets', async () => {
    const a = editor('a'),
      b = editor('b', 'b');
    let finish!: () => void;
    a.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ status: 'saved', receipt: savedWriteFixture() });
        }),
    );
    const coordinator = createModSaveCoordinator(feedback(), () => false);
    const first = coordinator.save();
    expect(coordinator.save()).toBe(first);
    await flushPromises();
    wire.active = 'b';
    const second = coordinator.save();
    await flushPromises();
    expect(b.save).not.toHaveBeenCalled();
    finish();
    await Promise.all([first, second]);
    expect(a.save).toHaveBeenCalledOnce();
    expect(b.save).toHaveBeenCalledOnce();
    coordinator.dispose();
  });
  it.each(['release', 'retarget', 'closing'])('preserves drafts when a captured editor is %s', async (change) => {
    const first = editor('a'),
      next = editor('b');
    let closing = false;
    first.save.mockImplementationOnce(async () => {
      if (change === 'release') next.release();
      else if (change === 'retarget') next.targetKey.value = 'new';
      else closing = true;
      return { status: 'saved', receipt: savedWriteFixture() };
    });
    const coordinator = createModSaveCoordinator(feedback(), () => closing);
    await coordinator.save();
    expect(next.save).not.toHaveBeenCalled();
    expect(next.dirty.value).toBe(true);
    coordinator.dispose();
  });
});
