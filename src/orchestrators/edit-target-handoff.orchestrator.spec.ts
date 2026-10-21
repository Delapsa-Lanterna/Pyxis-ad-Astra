import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { ref } from 'vue';
import { createFieldInputs } from '@/shared/runtime/field-inputs';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { entityTargetFixture } from '@/test/entity-target';
import { savedWriteFixture } from '@/test/write-result';
import { WINDOW_EVENTS } from '@/windows/window.events';
import type { AppFeedback, EditHandoffRequest, EditHandoffReply } from '@/shared/types';
const mocks = vi.hoisted(() => ({
  label: 'main',
  handlers: new Map<string, Set<(event: unknown) => void | Promise<void>>>(),
  sent: [] as Array<{ name: string; payload: unknown }>,
  query: vi.fn(),
  owners: vi.fn(async () => [] as string[]),
  reserve: vi.fn(async () => {}),
  release: vi.fn(async () => {}),
  focus: vi.fn(async () => true),
}));
vi.mock('@/windows/current.window', () => ({ currentWindowLabel: () => mocks.label }));
vi.mock('@/windows/tauri.events', () => ({
  listenWindowEvent: async (name: string, handler: (event: unknown) => void | Promise<void>) => {
    const handlers = mocks.handlers.get(name) ?? new Set();
    handlers.add(handler);
    mocks.handlers.set(name, handlers);
    return () => handlers.delete(handler);
  },
  emitWindowEvent: async (name: string, payload: unknown) => {
    mocks.sent.push({ name, payload });
    for (const handler of mocks.handlers.get(name) ?? []) void Promise.resolve().then(() => handler(payload));
  },
}));
vi.mock('@/services/entity-query.service', () => ({ querySessionEntityEditTarget: mocks.query }));
vi.mock('@/services/window.service', () => ({
  releaseNativeWindowTargets: mocks.release,
  queryEditTargetOwners: mocks.owners,
  reserveEditTargets: mocks.reserve,
  focusEditTargetOwner: mocks.focus,
}));
import { withEditTargetHandoff, createEntitySavePreparation, listenEditTargetHandoff } from './edit-target-handoff.orchestrator';
const target = { sessionId: 's', modRoot: 'M:/mod', path: 'M:/mod/ships.csv' };
let feedback: AppFeedback;
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  mocks.handlers.clear();
  mocks.sent = [];
  mocks.label = 'main';
  mocks.owners.mockResolvedValue([]);
  feedback = {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => 'save'),
  };
});
function participant(
  options: { dirty?: boolean; save?: () => Promise<import('@/shared/runtime/document-editor').DocumentSaveResult> } = {},
) {
  const dirty = ref(options.dirty ?? true),
    pending = ref(false),
    saving = ref(false),
    key = ref('table');
  const order: string[] = [];
  const save = vi.fn(
    options.save ??
      (async () => {
        order.push('save');
        dirty.value = false;
        return { status: 'saved' as const, receipt: savedWriteFixture() };
      }),
  );
  const commit = vi.fn(() => {
    order.push('input');
    return true;
  });
  const wait = vi.fn(async () => {
    order.push('wait');
    saving.value = false;
    pending.value = false;
    return true;
  });
  const inputs = createFieldInputs(key);
  vi.spyOn(inputs, 'commit').mockImplementation(async () => commit());
  const unregister = useSaveCommandStore().registerSaveSession({
    targetKey: key,
    modRoot: ref(target.modRoot),
    saving,
    pendingSynchronization: pending,
    waitForSave: wait,
    editing: { targets: ref([target]), label: 'ships', dirty, draftSession: { draftValue: ref({}), inputs }, save },
  });
  return { dirty, pending, saving, key, order, save, commit, wait, unregister };
}
describe('edit target handoff', () => {
  it('starts a fresh request after cancellation while the original confirmation is still open', async () => {
    const own = participant();
    let confirm!: (value: string) => void;
    vi.mocked(feedback.choose).mockImplementationOnce(() => new Promise((resolve) => (confirm = resolve)));
    const lifecycle = new AbortController();
    const cancelled = withEditTargetHandoff([target], feedback, async () => 'old', undefined, undefined, lifecycle.signal);
    await vi.waitFor(() => expect(feedback.choose).toHaveBeenCalledOnce());
    lifecycle.abort();
    own.dirty.value = false;
    const current = withEditTargetHandoff([target], feedback, async () => 'new');
    await expect(current).resolves.toBe('new');
    confirm('save');
    await expect(cancelled).resolves.toBeNull();
    expect(own.save).not.toHaveBeenCalled();
  });
  it.each(['same file', 'parent directory'] as const)(
    'ends reciprocal preparations for %s instead of waiting on each saving window',
    async (scope) => {
      mocks.label = 'managed-2';
      const stop = await listenEditTargetHandoff(feedback);
      const own = participant({ dirty: false });
      mocks.owners.mockResolvedValue(['main']);
      const lifecycle = new AbortController();
      const action = vi.fn(async () => true);
      const outgoing = withEditTargetHandoff([target], feedback, action, undefined, undefined, lifecycle.signal);
      await vi.waitFor(() => expect(mocks.sent.some((event) => event.name === WINDOW_EVENTS.editTargetPrepare)).toBe(true));
      own.saving.value = true;
      const request: EditHandoffRequest = {
        requestId: 'reciprocal',
        ownerLabel: 'main',
        receiverLabel: 'managed-2',
        targets: [{ ...target, path: scope === 'parent directory' ? 'm:\\MOD\\' : target.path }],
      };
      for (const handler of mocks.handlers.get(WINDOW_EVENTS.editTargetPrepare)!) await handler(request);
      const reply = mocks.sent.find((event) => event.name === WINDOW_EVENTS.editTargetPrepared)!.payload as EditHandoffReply;
      expect(reply.status).toBe('failed');
      expect(own.wait).not.toHaveBeenCalled();
      lifecycle.abort();
      await expect(outgoing).resolves.toBeNull();
      expect(action).not.toHaveBeenCalled();
      stop();
    },
  );
  it('cancels a confirmation before related drafts are written', async () => {
    const own = participant();
    const lifecycle = new AbortController();
    let confirm!: (value: string) => void;
    vi.mocked(feedback.choose).mockImplementationOnce(() => new Promise((resolve) => (confirm = resolve)));
    const action = vi.fn(async () => true);
    const pending = withEditTargetHandoff([target], feedback, action, undefined, undefined, lifecycle.signal);
    await vi.waitFor(() => expect(feedback.choose).toHaveBeenCalledOnce());
    lifecycle.abort();
    confirm('save');
    await expect(pending).resolves.toBeNull();
    expect(own.dirty.value).toBe(true);
    expect(own.save).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });
  it('ends remote preparation released while the confirmation is open', async () => {
    mocks.label = 'managed-2';
    const stop = await listenEditTargetHandoff(feedback);
    const own = participant();
    let confirm!: (value: string) => void;
    vi.mocked(feedback.choose).mockImplementationOnce(() => new Promise((resolve) => (confirm = resolve)));
    const request: EditHandoffRequest = { requestId: 'released', ownerLabel: 'main', receiverLabel: 'managed-2', targets: [target] };
    const pending = Promise.all([...mocks.handlers.get(WINDOW_EVENTS.editTargetPrepare)!].map((handler) => handler(request)));
    await vi.waitFor(() => expect(feedback.choose).toHaveBeenCalledOnce());
    for (const handler of mocks.handlers.get(WINDOW_EVENTS.editTargetRelease)!) await handler(request);
    confirm('save');
    await pending;
    expect(own.dirty.value).toBe(true);
    expect(own.save).not.toHaveBeenCalled();
    expect(mocks.sent.some((event) => event.name === WINDOW_EVENTS.editTargetPrepared)).toBe(false);
    stop();
  });
  it('keeps participants locked until the accepted baseline explicitly releases preparation', async () => {
    const own = participant({ dirty: false });
    const commands = useSaveCommandStore();
    let release!: () => Promise<void>;
    await withEditTargetHandoff(
      [target],
      feedback,
      async () => true,
      undefined,
      (cleanup) => (release = cleanup),
    );
    expect(commands.isEditTargetLocked(own.key.value)).toBe(true);
    expect(mocks.release).not.toHaveBeenCalled();
    await release();
    expect(commands.isEditTargetLocked(own.key.value)).toBe(false);
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it('ends a target transition that occurred during confirmation and retains the source draft', async () => {
    const own = participant();
    vi.mocked(feedback.choose).mockImplementationOnce(async () => {
      own.key.value = 'other';
      return 'save';
    });
    const action = vi.fn(async () => true);
    await expect(withEditTargetHandoff([target], feedback, action)).resolves.toBeNull();
    expect(action).not.toHaveBeenCalled();
  });
  it('waits for pending sync, submits input, saves and passes the receipt before action', async () => {
    const own = participant();
    own.pending.value = true;
    const action = vi.fn(async (receipts) => {
      expect(receipts).toHaveLength(1);
      own.order.push('action');
      return 'ready';
    });
    await expect(withEditTargetHandoff([target], feedback, action)).resolves.toBe('ready');
    expect(own.order).toEqual(['wait', 'input', 'save', 'action']);
    expect(mocks.reserve).toHaveBeenCalledOnce();
    expect(mocks.release).toHaveBeenCalledOnce();
  });
  it('retains the original editor on cancelled confirmation', async () => {
    const own = participant();
    vi.mocked(feedback.choose).mockResolvedValueOnce(null);
    const action = vi.fn(async () => true);
    await expect(withEditTargetHandoff([target], feedback, action)).resolves.toBeNull();
    expect(own.dirty.value).toBe(true);
    expect(own.save).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();
  });
  it('retains input and ends preparation on a commit failure', async () => {
    const own = participant();
    own.commit.mockImplementation(() => {
      throw new Error('unfinished JSON');
    });
    await expect(withEditTargetHandoff([target], feedback, async () => true)).rejects.toThrow('unfinished JSON');
    expect(own.dirty.value).toBe(true);
    expect(own.save).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it('ends preparation when saving produced new edits', async () => {
    participant({ save: async () => ({ status: 'saved' as const, receipt: savedWriteFixture() }) });
    const action = vi.fn(async () => true);
    await expect(withEditTargetHandoff([target], feedback, action)).rejects.toMatchObject({ code: 'joint.new_edits' });
    expect(action).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });
  it('shares repeated requests and releases the reservation after an action failure', async () => {
    participant({ dirty: false });
    let finish!: (value: boolean) => void;
    const action = vi.fn(() => new Promise<boolean>((resolve) => (finish = resolve)));
    const first = withEditTargetHandoff([target], feedback, action);
    const second = withEditTargetHandoff([target], feedback, action);
    expect(first).toBe(second);
    await vi.waitFor(() => expect(action).toHaveBeenCalledOnce());
    finish(true);
    await first;
    await expect(
      withEditTargetHandoff([target], feedback, async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    expect(mocks.release).toHaveBeenCalledTimes(2);
  });
  it('handles remote request identity and receiver disposal through the single event protocol', async () => {
    mocks.owners.mockResolvedValue(['managed-2']);
    const own = participant({ dirty: false });
    const action = vi.fn(async () => true);
    const pending = withEditTargetHandoff([target], feedback, action);
    await vi.waitFor(() => expect(mocks.sent.some((event) => event.name === WINDOW_EVENTS.editTargetPrepare)).toBe(true));
    const request = mocks.sent.find((event) => event.name === WINDOW_EVENTS.editTargetPrepare)!.payload as EditHandoffRequest;
    for (const handler of mocks.handlers.get(WINDOW_EVENTS.editTargetPrepared)!)
      await handler({ ...request, ownerLabel: 'other', status: 'ready', receipts: [] } as EditHandoffReply);
    for (const handler of mocks.handlers.get(WINDOW_EVENTS.editTargetPrepared)!)
      await handler({ ...request, targets: [{ ...target, sessionId: 'other' }], status: 'ready', receipts: [] } as EditHandoffReply);
    expect(action).not.toHaveBeenCalled();
    for (const handler of mocks.handlers.get(WINDOW_EVENTS.managedWindowReleased)!) await handler({ label: 'managed-2' });
    await expect(pending).resolves.toBeNull();
    expect(own.dirty.value).toBe(false);
  });
  it('receiver sends structured errors and requester focuses its owner', async () => {
    mocks.label = 'managed-2';
    const stop = await listenEditTargetHandoff(feedback);
    participant({
      save: async () => {
        throw new Error('save blocked');
      },
    });
    const request: EditHandoffRequest = { requestId: 'request', ownerLabel: 'main', receiverLabel: 'managed-2', targets: [target] };
    for (const handler of mocks.handlers.get(WINDOW_EVENTS.editTargetPrepare)!) await handler(request);
    const reply = mocks.sent.find((event) => event.name === WINDOW_EVENTS.editTargetPrepared)!.payload as EditHandoffReply;
    expect(reply.status).toBe('failed');
    if (reply.status === 'failed') expect(reply.diagnostic.message).toBe('save blocked');
    stop();
  });
  it('identity preparation queries the authoritative target after related saves', async () => {
    participant({ dirty: false });
    const source = entityTargetFixture('ship', 'old');
    mocks.query.mockResolvedValue({ target: source, baseVersions: [{ path: target.path, fingerprint: 'v' }] });
    const client = await createEntitySavePreparation(feedback, () => 'self');
    const submit = vi.fn(async (info) => info.target.id);
    await expect(client.withPreparation('s', target.modRoot, source, submit)).resolves.toBe('old');
    expect(mocks.query).toHaveBeenCalledTimes(2);
    client.dispose();
  });
});
