import { dialogText } from '@/test/unit/dialog-text';
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { flushPromises } from '@vue/test-utils';
import type { AppFeedback, ManagedWindowContext, WindowSaveMessage, WindowSaveReply, WindowSaveRequest } from '@/shared/types';
import { createFieldInputs } from '@/shared/runtime/field-inputs';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';
import { createModSaveCoordinator } from './mod-save.orchestrator';
import { registerWindowSaveReceiver, unregisterWindowSaveReceiver, queryEditTargetOwners } from '@/services/window.service';
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
function coordinatorFixture(...args: Parameters<typeof createModSaveCoordinator>) {
  const coordinator = createModSaveCoordinator(...args);
  onTestFinished(async () => {
    coordinator.dispose();
    await flushPromises();
  });
  return coordinator;
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
      coordinator = coordinatorFixture(output, () => false);
    await coordinator.saveCurrentMod();
    expect(own.save).toHaveBeenCalledOnce();
    expect(other.save).not.toHaveBeenCalled();
    expect(output.success).toHaveBeenCalledWith('已保存 1 项。');
  });
  it('continues after cancellation and failure and reports concrete outcomes', async () => {
    const cancelled = editor('a'),
      failed = editor('b'),
      saved = editor('c');
    cancelled.handle.editing.save = vi.fn(async () => ({ status: 'cancelled' as const }));
    failed.save.mockRejectedValueOnce(new Error('fixture failure'));
    const output = feedback(),
      coordinator = coordinatorFixture(output, () => false);
    await coordinator.saveCurrentMod();
    expect(saved.save).toHaveBeenCalledOnce();
    expect(dialogText(vi.mocked(output.choose).mock.lastCall![0])).toContain('已保存 1 项，取消 1 项，失败 1 项');
    expect(output.choose).toHaveBeenCalledWith(expect.objectContaining({ type: 'warning', cancelText: '关闭', choices: [] }));
    expect(dialogText(vi.mocked(output.choose).mock.calls[0]![0])).toContain('M:/a/b');
  });
  it('saves the triggering child Mod before its main-window documents', async () => {
    const a = editor('a', 'a'),
      b = editor('main-b', 'b');
    coordinatorFixture(feedback(), () => false);
    setActivePinia(createPinia());
    wire.label = 'child';
    wire.context.value = { identity: { type: 'file', sessionId: 'b', modRoot: 'M:/b', path: 'M:/b/file' } } as ManagedWindowContext;
    const child = editor('child-b', 'b'),
      coordinator = coordinatorFixture(feedback(), () => false);
    wire.owners = ['main', 'child'];
    await coordinator.saveCurrentMod();
    expect(wire.order).toEqual(['child-b', 'main-b']);
    expect(a.save).not.toHaveBeenCalled();
    expect(b.save).toHaveBeenCalledOnce();
    expect(child.save).toHaveBeenCalledOnce();
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
    const coordinator = coordinatorFixture(feedback(), () => false);
    const first = coordinator.saveCurrentMod();
    expect(coordinator.saveCurrentMod()).toBe(first);
    await flushPromises();
    wire.active = 'b';
    const second = coordinator.saveCurrentMod();
    onTestFinished(async () => {
      finish();
      await Promise.all([first, second]);
    });
    await flushPromises();
    expect(b.save).not.toHaveBeenCalled();
    finish();
    await Promise.all([first, second]);
    expect(a.save).toHaveBeenCalledOnce();
    expect(b.save).toHaveBeenCalledOnce();
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
    const coordinator = coordinatorFixture(feedback(), () => closing);
    await coordinator.saveCurrentMod();
    expect(next.save).not.toHaveBeenCalled();
    expect(next.dirty.value).toBe(true);
  });
  it('releases the registered generation when registration finishes after disposal', async () => {
    let complete!: (generation: number) => void;
    vi.mocked(registerWindowSaveReceiver).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const coordinator = createModSaveCoordinator(feedback(), () => false);
    onTestFinished(async () => {
      complete(31);
      await flushPromises();
    });
    coordinator.dispose();
    complete(31);
    await coordinator.ready;
    await flushPromises();
    expect(unregisterWindowSaveReceiver).toHaveBeenCalledExactlyOnceWith(31);
  });
  it('releases a failed batch before accepting another request for the same Mod', async () => {
    const own = editor('csv'),
      output = feedback(),
      coordinator = coordinatorFixture(output, () => false);
    vi.mocked(queryEditTargetOwners).mockRejectedValueOnce(new Error('fixture owner query failure'));
    await coordinator.saveCurrentMod();
    expect(output.error).toHaveBeenCalledOnce();
    expect(wire.replies.size).toBe(0);
    await coordinator.saveCurrentMod();
    expect(own.save).toHaveBeenCalledOnce();
    expect(output.success).toHaveBeenCalledWith('已保存 1 项。');
    expect(wire.replies.size).toBe(0);
  });
});
