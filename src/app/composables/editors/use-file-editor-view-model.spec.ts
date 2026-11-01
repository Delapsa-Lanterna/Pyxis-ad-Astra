import { projectChangeFixture, committedChangeFixture, dispatchProjectChangeFixture } from '@/test/unit/project-changes';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { mountSetup } from '@/test/unit/mount-setup';
import FileEditorContent from '@/app/FileEditorContent.vue';
import { nButton } from '@/test/unit/ui-stubs';
import type { ManagedWindowContext, WindowContextFor } from '@/shared/types';

enableAutoUnmount(afterEach);

beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
});

vi.mock('@/orchestrators/project-sync.orchestrator', async () => ({
  ...(await import('@/test/unit/project-changes')),
  beginSavedWrite: (await import('@/test/unit/project-changes')).withSavedCompletion((value) => {
    const snapshot = value as { target: { modRoot: string; sessionId: string | null }; meta: { receipt: unknown } };
    return mocks.publishCommittedWrite(snapshot.target.modRoot, snapshot.meta.receipt, snapshot.target.sessionId);
  }),
  publishCommittedWrite: mocks.publishCommittedWrite,
  listenSavedIdentity: vi.fn(async (handler) => {
    mocks.identityHandler = handler;
    return () => {};
  }),
}));

vi.mock('@/services/window.service', () => ({ releaseNativeWindowTargets: vi.fn(async () => {}) }));
const mocks = vi.hoisted(() => ({
  request: null as null | ((request: ManagedWindowContext) => Promise<void>),
  identityHandler: null as null | ((event: import('@/shared/types').CommittedWriteEvent) => Promise<void>),
  followIdentity: vi.fn(),
  loadEditableFileData: vi.fn(),
  writeEditableFileText: vi.fn(),
  publishCommittedWrite: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  feedback: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null as string | null),
  },
}));

vi.mock('@/services/files.service', () => ({
  followFileTextIdentity: mocks.followIdentity,
  loadEditableFileData: mocks.loadEditableFileData,
  writeEditableFileText: mocks.writeEditableFileText,
}));
vi.mock('@/orchestrators/edit-target-handoff.orchestrator', () => ({
  createEntitySavePreparation: async () => ({
    withPreparation: (_session: string, _root: string, _source: unknown, submit: (info: null) => Promise<unknown>) => submit(null),
    finish: vi.fn(async () => {}),
    dispose: vi.fn(),
  }),
}));
vi.mock('@/orchestrators/entity-write.orchestrator', () => ({
  chooseEntityFilename: vi.fn(async () => false),
}));
vi.mock('@/orchestrators/window-identity.orchestrator', () => ({
  reserveFileIdentityIntent: vi.fn(async () => {}),
  retargetFileWindow: vi.fn(async () => {}),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));
vi.mock('@/app/composables/use-shortcut-dispatch', () => ({ useShortcutDispatch: vi.fn() }));
vi.mock('@/app/composables/use-window-close-state', () => ({
  useWindowCloseState: () => null,
  useWindowCloseParticipant: () => ({ install: async () => {}, dispose: vi.fn() }),
}));
vi.mock('@/windows/window-context.window', () => ({
  useWindowContext: () => ({ value: windowFixture() }),
}));
vi.mock('@/app/composables/use-managed-window-requests', () => ({
  useManagedWindowRequests: (handler: typeof mocks.request) => {
    mocks.request = handler;
  },
}));

function windowFixture(): WindowContextFor<'file-editor'> {
  return {
    kind: 'file-editor',
    label: 'file',
    revision: 1,
    requestId: 1,
    receiverGeneration: 1,
    title: '文件编辑器',
    identity: { type: 'file', sessionId: 's1', modRoot: 'C:/mods/alpha', path: 'C:/mods/alpha/notes.txt' },
    input: {
      kind: 'file-editor',
      location: { message: 'old diagnostic', contextLabel: '错误', contextSeverity: 'error', line: 2, column: 1 },
    },
  };
}

function pendingRead() {
  let resolve!: (value: { text: string; baseVersions: [] }) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<{ text: string; baseVersions: [] }>((ready, fail) => {
    resolve = ready;
    reject = fail;
  });
  return { promise, resolve, reject };
}

import { useFileEditorViewModel, type FileEditorViewModelParams } from './use-file-editor-view-model';

function paramsFixture(overrides: Partial<FileEditorViewModelParams> = {}): FileEditorViewModelParams {
  return {
    mode: 'session',
    filePath: 'C:/mods/alpha/data/hulls/test.file',
    modRoot: 'C:/mods/alpha',
    sessionId: 's1',
    title: '文件编辑器',
    line: null,
    column: null,
    ...overrides,
  };
}

async function initializeViewModel(params: FileEditorViewModelParams) {
  const { value: viewModel } = mountSetup(() => useFileEditorViewModel(params));
  await viewModel.initialize();
  return viewModel;
}

function textApplied(event: { sessionId: string; modRoot: string; path: string; text: string; baseVersions: [] }) {
  const path = event.path.startsWith(event.modRoot) ? event.path : event.modRoot + '/' + event.path;
  const result = savedWriteFixture({ text: event.text }, { kind: 'text', path });
  result.baseVersions = [{ path, fingerprint: 'saved' }];
  void dispatchProjectChangeFixture(committedChangeFixture(result, event.sessionId, event.modRoot));
}
describe('useFileEditorViewModel loading', () => {
  it.each([false, true])('refreshes disk once and preserves a dirty draft=%s', async (dirty) => {
    mocks.loadEditableFileData.mockResolvedValue({ text: 'base', baseVersions: [] });
    const vm = await initializeViewModel(paramsFixture());
    if (dirty) vm.updateText('draft');
    mocks.loadEditableFileData.mockClear();
    mocks.loadEditableFileData.mockResolvedValueOnce({ text: 'disk', baseVersions: [] });
    await vm.initialize();
    expect(mocks.loadEditableFileData).toHaveBeenCalledTimes(1);
    expect(vm.text.value).toBe(dirty ? 'draft' : 'disk');
    expect(vm.hasPendingExternalText.value).toBe(dirty);
    if (dirty) {
      vm.undoEdit();
      expect(vm.text.value).toBe('base');
      vm.redoEdit();
      expect(vm.text.value).toBe('draft');
      vm.loadPendingExternalText();
      mocks.feedback.confirmWarning.mock.calls.at(-1)![0].onConfirm();
      expect(vm.text.value).toBe('disk');
    }
    vm.dispose();
  });
  it('keeps a draft on read failure and clears the error after retry', async () => {
    mocks.loadEditableFileData.mockResolvedValue({ text: 'base', baseVersions: [] });
    const vm = await initializeViewModel(paramsFixture());
    vm.updateText('draft');
    mocks.loadEditableFileData.mockRejectedValueOnce(new Error('access denied'));
    await expect(vm.initialize()).rejects.toThrow('access denied');
    expect(vm.contextMessage.value).toContain('access denied');
    expect(vm.text.value).toBe('draft');
    vm.applyLocation(windowFixture().input.location);
    expect(vm.contextMessage.value).toContain('access denied');
    await vm.initialize();
    expect(vm.contextMessage.value).toBe('');
    expect(vm.text.value).toBe('draft');
    vm.dispose();
  });
  it.each(['resolve', 'reject'] as const)('discards a late read %s after a newer open', async (completion) => {
    mocks.loadEditableFileData.mockResolvedValue({ text: 'base', baseVersions: [] });
    const vm = await initializeViewModel(paramsFixture());
    const pending = pendingRead();
    mocks.loadEditableFileData.mockReturnValueOnce(pending.promise);
    const older = vm.initialize();
    await flushPromises();
    await vm.initialize();
    if (completion === 'resolve') pending.resolve({ text: 'old', baseVersions: [] });
    else pending.reject(new Error('old failure'));
    await older;
    expect(vm.text.value).toBe('base');
    expect(vm.contextMessage.value).toBe('');
    vm.dispose();
  });
  it('loads the file text into the draft and tracks the line count', async () => {
    mocks.loadEditableFileData.mockResolvedValue({ path: 'x', text: 'line1\nline2', baseVersions: [] });
    const viewModel = await initializeViewModel(paramsFixture());
    expect(viewModel.text.value).toBe('line1\nline2');
    expect(viewModel.lineCount.value).toBe(2);
    expect(viewModel.dirty.value).toBe(false);
    viewModel.dispose();
  });

  it('delivers initial read failure through its acceptance promise', async () => {
    mocks.loadEditableFileData.mockRejectedValue(new Error('unreadable'));
    await expect(initializeViewModel(paramsFixture())).rejects.toThrow('unreadable');
  });
  it('refuses to operate without a file path', async () => {
    await expect(initializeViewModel(paramsFixture({ filePath: null }))).rejects.toThrow('文件目标不可用');
    expect(mocks.feedback.error).toHaveBeenCalledWith('缺少文件路径');
  });
});

describe('useFileEditorViewModel editing', () => {
  async function loadedViewModel() {
    mocks.loadEditableFileData.mockResolvedValue({ path: 'x', text: 'base', baseVersions: [] });
    return initializeViewModel(paramsFixture());
  }

  it('marks the draft dirty on edits and restores it on cancel', async () => {
    const viewModel = await loadedViewModel();
    viewModel.updateText('changed');
    expect(viewModel.dirty.value).toBe(true);
    viewModel.cancelChanges();
    expect(viewModel.dirty.value).toBe(false);
    expect(viewModel.text.value).toBe('base');
    viewModel.dispose();
  });

  it('ignores no-op text updates', async () => {
    const viewModel = await loadedViewModel();
    viewModel.updateText('base');
    expect(viewModel.dirty.value).toBe(false);
    expect(viewModel.canUndo.value).toBe(false);
    viewModel.dispose();
  });

  it('undoes and redoes text edits', async () => {
    const viewModel = await loadedViewModel();
    viewModel.updateText('changed');
    expect(viewModel.canUndo.value).toBe(true);
    viewModel.undoEdit();
    expect(viewModel.text.value).toBe('base');
    expect(viewModel.canRedo.value).toBe(true);
    viewModel.redoEdit();
    expect(viewModel.text.value).toBe('changed');
    viewModel.dispose();
  });

  it('updates the open text history capacity independently of saved file history', async () => {
    const vm = await loadedViewModel();
    vm.updateText('one');
    vm.updateText('two');
    vm.updateText('three');
    useSettingsStore().setFileHistoryLimit(1);
    vm.undoEdit();
    expect(vm.text.value).toBe('two');
    useSettingsStore().setEditHistoryLimit(1);
    vm.undoEdit();
    expect(vm.text.value).toBe('one');
    vm.undoEdit();
    expect(vm.text.value).toBe('one');
    vm.redoEdit();
    expect(vm.text.value).toBe('two');
    vm.dispose();
    expect(vm.canUndo.value).toBe(false);
    useSettingsStore().setEditHistoryLimit(2);
    expect(vm.canRedo.value).toBe(false);
  });

  it('saves through the write service and records history only in session mode', async () => {
    const result = {
      sessionUpdates: [],
      baseVersions: [],

      history: { revision: 1, undoStack: [], redoStack: [] },
      changes: [],
      invalidation: {},
      identityChanges: [],
      keyMap: [],
      content: null,
    };
    mocks.writeEditableFileText.mockResolvedValue(result);
    const viewModel = await loadedViewModel();
    viewModel.updateText('saved text');
    await viewModel.saveFile();
    expect(mocks.writeEditableFileText).toHaveBeenCalledWith(
      's1',
      'C:/mods/alpha',
      'C:/mods/alpha/data/hulls/test.file',
      'saved text',
      [],
      undefined,
      { keepFilename: false },
    );
    expect(mocks.publishCommittedWrite).toHaveBeenCalledTimes(1);
    expect(mocks.feedback.success).toHaveBeenCalledWith('文件已保存');
    expect(viewModel.dirty.value).toBe(false);
    viewModel.dispose();
  });

  it('writes recovery credentials and publishes their actual associated session updates', async () => {
    mocks.loadEditableFileData.mockResolvedValue({ path: 'x', text: 'base', baseVersions: [] });
    const viewModel = await initializeViewModel(paramsFixture({ mode: 'recovery', sessionId: null }));
    mocks.writeEditableFileText.mockResolvedValue({
      sessionUpdates: [],
      baseVersions: [],

      history: { revision: 1, undoStack: [], redoStack: [] },
      changes: [],
      invalidation: {},
      identityChanges: [],
      keyMap: [],
      content: null,
    });
    viewModel.updateText('recovered');
    await viewModel.saveFile();
    expect(mocks.writeEditableFileText).toHaveBeenCalledWith(
      null,
      'C:/mods/alpha',
      'C:/mods/alpha/data/hulls/test.file',
      'recovered',
      [],
      undefined,
      { keepFilename: false },
    );
    expect(mocks.publishCommittedWrite).toHaveBeenCalledWith('C:/mods/alpha', expect.any(Object), null);
    viewModel.dispose();
  });

  it('reports save failures and keeps the draft dirty', async () => {
    const viewModel = await loadedViewModel();
    mocks.writeEditableFileText.mockRejectedValue(new Error('locked'));
    viewModel.updateText('will fail');
    await viewModel.saveFile();
    expect(mocks.feedback.error).toHaveBeenCalledWith(expect.anything(), '保存文件失败');
    expect(viewModel.dirty.value).toBe(true);
    viewModel.dispose();
  });

  it('retains subsequent text and both history actions after accepting the written baseline', async () => {
    const vm = await loadedViewModel();
    let release!: (result: ReturnType<typeof savedWriteFixture>) => void;
    mocks.writeEditableFileText.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    vm.updateText('submitted');
    const writing = vm.saveFile();
    vm.updateText('later');
    mocks.loadEditableFileData.mockClear();
    mocks.loadEditableFileData.mockResolvedValue({ text: 'submitted', baseVersions: [{ path: 'file', fingerprint: 'v2' }] });
    const reopening = vm.initialize();
    await flushPromises();
    expect(mocks.loadEditableFileData).toHaveBeenCalledTimes(0);
    release({ ...savedWriteFixture(), baseVersions: [{ path: 'file', fingerprint: 'v2' }] });
    await writing;
    await reopening;
    expect(mocks.loadEditableFileData).toHaveBeenCalledTimes(1);
    expect(vm.text.value).toBe('later');
    expect(vm.dirty.value).toBe(true);
    vm.undoEdit();
    expect(vm.text.value).toBe('submitted');
    expect(vm.dirty.value).toBe(false);
    vm.undoEdit();
    expect(vm.text.value).toBe('base');
    expect(vm.dirty.value).toBe(true);
    expect(vm.externalTextNotice.value).toBe('');
    vm.dispose();
  });
});

describe('useFileEditorViewModel external text', () => {
  it.each([true, false])('uses a text receipt once with complete entity metadata=%s', async (complete) => {
    const target = entityTargetFixture('ship', 'probe', 'existing', 'C:/mods/alpha');
    const loaded = { text: 'base', entity: { target, baseVersions: [] }, baseVersions: [] };
    mocks.loadEditableFileData.mockResolvedValue(loaded);
    const vm = await initializeViewModel(paramsFixture({ filePath: target.write.path }));
    mocks.loadEditableFileData.mockClear();
    mocks.loadEditableFileData.mockResolvedValue({ ...loaded, text: 'external' });
    const result = savedWriteFixture({ text: 'external' }, { kind: 'text', path: target.write.path });
    result.baseVersions = [{ path: target.write.path, fingerprint: 'saved' }];
    result.invalidation.paths = [target.write.path];
    result.identityChanges = complete ? [{ before: target, after: target }] : [];
    void dispatchProjectChangeFixture(committedChangeFixture(result, 's1', 'C:/mods/alpha'));
    await flushPromises();
    expect(mocks.loadEditableFileData).toHaveBeenCalledTimes(complete ? 0 : 1);
    expect(vm.text.value).toBe('external');
    vm.dispose();
  });
  it('keeps unfinished text and follows its new identity after parsing becomes possible', async () => {
    const before = entityTargetFixture('ship', 'old');
    const after = entityTargetFixture('ship', 'new');
    mocks.loadEditableFileData.mockResolvedValueOnce({
      path: before.write.path,
      text: "{hullId:'old'}",
      baseVersions: [],
      entity: { target: before, baseVersions: [] },
    });
    const vm = await initializeViewModel(paramsFixture({ modRoot: 'M:/mod', filePath: before.write.path }));
    vm.updateText('{hullId:');
    mocks.feedback.choose.mockResolvedValueOnce('follow');
    mocks.followIdentity.mockRejectedValueOnce({
      code: 'parse.json_syntax',
      message: 'Unfinished text',
      location: { path: null, line: 1, column: 9 },
    });
    const result = savedWriteFixture();
    result.identityChanges = [{ before, after }];

    await expect(
      mocks.identityHandler!({ originWindowLabel: 'peer', reason: 'save', sessionId: 's1', modRoot: 'm:/MOD/', result }),
    ).rejects.toMatchObject({ code: 'parse.json_syntax' });
    expect(vm.text.value).toBe('{hullId:');
    expect(vm.filePath.value).toBe(before.write.path);
    expect(vm.externalTextNotice.value).toContain('修正文本');
    expect(vm.targetColumn.value).toBe(9);
    mocks.followIdentity.mockResolvedValueOnce('{hullId:"new", extra: 2}');
    mocks.loadEditableFileData.mockResolvedValueOnce({
      path: after.write.path,
      text: '{hullId:"new"}',
      entity: { target: after, baseVersions: [] },
      baseVersions: [],
    });
    vm.updateText("{hullId:'old', extra: 2}");
    await vi.waitFor(() => expect(vm.filePath.value).toBe(after.write.path));
    expect(vm.text.value).toBe('{hullId:"new", extra: 2}');
    expect(vm.dirty.value).toBe(true);
    expect(vm.externalTextNotice.value).toBe('');
    expect(vm.canUndo.value).toBe(false);
    vm.dispose();
  });
  it('discards an external read superseded by the local save', async () => {
    mocks.loadEditableFileData.mockResolvedValueOnce({ path: 'C:/mods/alpha/notes.txt', text: 'base', baseVersions: [] });
    const vm = await initializeViewModel(paramsFixture({ filePath: 'C:/mods/alpha/notes.txt' }));
    let release!: (loaded: { text: string; baseVersions: [] }) => void;
    mocks.loadEditableFileData.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const reading = projectChangeFixture('s1', { ...savedWriteFixture().invalidation, ...{ paths: ['notes.txt'] } }, 'C:/mods/alpha');
    vm.updateText('saved B');
    mocks.writeEditableFileText.mockResolvedValueOnce({ ...savedWriteFixture({ text: 'saved B' }), changes: [], baseVersions: [] });
    await vm.saveFile();
    release({ text: 'older A', baseVersions: [] });
    await reading;
    expect(vm.text.value).toBe('saved B');
    expect(vm.dirty.value).toBe(false);
    vm.dispose();
  });
  it.each(['data/hulls/test.file', 'data/hulls', 'C:/mods/alpha/data/hulls/test.file'])(
    'stages a dirty file version from the invalidation path %s',
    async (path) => {
      mocks.loadEditableFileData.mockResolvedValueOnce({ path: 'x', text: 'base', baseVersions: [] });
      const viewModel = await initializeViewModel(paramsFixture({ filePath: 'C:/mods/alpha/data/hulls/test.file' }));
      viewModel.updateText('local');
      mocks.loadEditableFileData.mockResolvedValueOnce({ path: 'x', text: 'external', baseVersions: [] });
      await projectChangeFixture('s1', { ...savedWriteFixture().invalidation, ...{ paths: [path] } }, 'C:/mods/alpha');
      await flushPromises();
      expect(mocks.loadEditableFileData).toHaveBeenLastCalledWith('s1', 'C:/mods/alpha', 'C:/mods/alpha/data/hulls/test.file');
      expect(viewModel.text.value).toBe('local');
      expect(viewModel.hasPendingExternalText.value).toBe(true);
      viewModel.loadPendingExternalText();
      mocks.feedback.confirmWarning.mock.calls.at(-1)![0].onConfirm();
      expect(viewModel.text.value).toBe('external');
      viewModel.dispose();
    },
  );

  it('stages external text while dirty and shows the notice', async () => {
    mocks.loadEditableFileData.mockResolvedValue({ path: 'x', text: 'base', baseVersions: [] });
    const viewModel = await initializeViewModel(paramsFixture());
    viewModel.updateText('local edit');
    textApplied!({ sessionId: 's1', modRoot: 'C:/mods/alpha', path: 'data/hulls/test.file', text: 'external', baseVersions: [] });

    expect(viewModel.dirty.value).toBe(true);
    expect(viewModel.text.value).toBe('local edit');
    expect(viewModel.hasPendingExternalText.value).toBe(true);
    expect(viewModel.externalTextNotice.value).toContain('外部文本已更新');

    viewModel.loadPendingExternalText();
    mocks.feedback.confirmWarning.mock.calls.at(-1)![0].onConfirm();
    expect(viewModel.text.value).toBe('external');
    expect(viewModel.hasPendingExternalText.value).toBe(false);
    viewModel.dispose();
  });

  it('applies external text directly when clean and filters foreign targets', async () => {
    mocks.loadEditableFileData.mockResolvedValue({ path: 'x', text: 'base', baseVersions: [] });
    const viewModel = await initializeViewModel(paramsFixture());
    textApplied!({ sessionId: 'other', modRoot: 'C:/mods/alpha', path: 'data/hulls/test.file', text: 'foreign', baseVersions: [] });
    expect(viewModel.text.value).toBe('base');

    textApplied!({ sessionId: 's1', modRoot: 'C:/mods/alpha', path: 'data/hulls/test.file', text: 'fresh', baseVersions: [] });
    expect(viewModel.text.value).toBe('fresh');
    expect(viewModel.hasPendingExternalText.value).toBe(false);
    viewModel.dispose();
  });

  it('updates location independently of the current text and errors', async () => {
    mocks.loadEditableFileData.mockResolvedValue({ path: 'x', text: 'base', baseVersions: [] });
    const viewModel = await initializeViewModel(paramsFixture());
    viewModel.applyLocation({ message: 'parse error', contextLabel: '错误', contextSeverity: 'error', line: 3, column: 2 });
    expect(viewModel.contextSeverity.value).toBe('error');
    expect(viewModel.contextMessage.value).toBe('');
    expect(viewModel.targetLine.value).toBe(3);
    expect(viewModel.targetColumn.value).toBe(2);
    viewModel.dispose();
  });
});

it('renders reading, encoding failure, and a successful retry with line navigation', async () => {
  const pending = pendingRead();
  mocks.loadEditableFileData.mockReturnValueOnce(pending.promise);
  const wrapper = mount(FileEditorContent, { global: { stubs: { 'n-button': nButton } } });
  const request = windowFixture();
  const opening = mocks.request!(request);
  await flushPromises();
  expect(wrapper.get('.file-editor-status').text()).toBe('正在读取文件…');
  const error = {
    code: 'text.invalid_utf8',
    message: 'invalid bytes',
    location: { path: request.identity.path, line: null, column: null },
  };
  pending.reject(error);
  await expect(opening).rejects.toEqual(error);
  await flushPromises();
  expect(wrapper.get('.file-editor-message.danger').text()).toContain('请选择文件当前使用的编码');
  expect(wrapper.findAll('button').map((button) => button.text())).toContain('重试');
  expect(mocks.feedback.error).toHaveBeenLastCalledWith(error, '读取文件失败');
  mocks.loadEditableFileData.mockResolvedValueOnce({ text: 'first\nsecond', baseVersions: [] });
  await mocks.request!(request);
  expect(wrapper.find('.file-editor-message').exists()).toBe(false);
  expect(wrapper.get('textarea').element.value).toBe('first\nsecond');
  expect(wrapper.get('textarea').element.selectionStart).toBe(6);
  expect(wrapper.get('.file-editor-line-number.active').text()).toBe('2');
});
