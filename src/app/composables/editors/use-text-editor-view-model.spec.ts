import type { TextFileData, RowData } from '@/shared/types';
import type * as TextEditorServiceModule from '@/services/text-file-editing.service';
import type { followTextIdentity } from '@/services/text-editor.service';
import { projectChangeFixture, committedChangeFixture, dispatchProjectChangeFixture } from '@/test/unit/project-changes';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import { entityTargetFixture } from '@/test/fixtures/entity-target';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { mountSetup } from '@/test/unit/mount-setup';
import TextEditorContent from '@/app/TextEditorContent.vue';
import TextEditorSurface from '@/shared/ui/TextEditorSurface.vue';
import { textEditorSurface } from '@/test/unit/text-editor-surface';
import * as textDocument from '@/shared/runtime/text-document';
import { nButton } from '@/test/unit/ui-stubs';
import type { AppFeedback, ManagedWindowContext, WindowContextFor, CommittedWriteEvent } from '@/shared/types';

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
  identityHandler: null as null | ((event: CommittedWriteEvent) => Promise<void>),
  followIdentity: vi.fn<typeof followTextIdentity>(),
  loadTextFile: vi.fn<typeof TextEditorServiceModule.loadTextFile>(),
  saveTextFile: vi.fn<typeof TextEditorServiceModule.saveTextFile>(),
  publishCommittedWrite: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
  feedback: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn<AppFeedback['confirmDanger']>(),
    confirmWarning: vi.fn<AppFeedback['confirmWarning']>(),
    choose: vi.fn(async () => null as string | null),
  },
}));

vi.mock('@/services/text-file-editing.service', () => ({
  loadTextFile: mocks.loadTextFile,
  saveTextFile: mocks.saveTextFile,
}));
vi.mock('@/orchestrators/window-identity.orchestrator', () => ({
  retargetTextEditorWindow: vi.fn(async () => {}),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => mocks.feedback,
}));
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

function windowFixture(): WindowContextFor<'text-editor'> {
  return {
    kind: 'text-editor',
    label: 'file',
    revision: 1,
    requestId: 1,
    receiverGeneration: 1,
    title: '文本编辑器',
    identity: { type: 'text-editor', sessionId: 's1', modRoot: 'C:/mods/alpha', path: 'C:/mods/alpha/notes.txt' },
    input: {
      kind: 'text-editor',
      location: { message: 'old diagnostic', contextLabel: '错误', contextSeverity: 'error', line: 2, column: 1 },
    },
  };
}

function textFileFixture(text: string, overrides: Partial<TextFileData> = {}): TextFileData {
  return { path: 'C:/mods/alpha/data/hulls/test.file', entity: null, baseVersions: [], text, ...overrides };
}
function pendingRead() {
  let resolve!: (value: TextFileData) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<TextFileData>((ready, fail) => {
    resolve = ready;
    reject = fail;
  });
  return { promise, resolve, reject };
}

import { useTextEditorViewModel, type TextEditorViewModelParams } from './use-text-editor-view-model';

function paramsFixture(overrides: Partial<TextEditorViewModelParams> = {}): TextEditorViewModelParams {
  return {
    mode: 'session',
    filePath: 'C:/mods/alpha/data/hulls/test.file',
    modRoot: 'C:/mods/alpha',
    sessionId: 's1',
    title: '文本编辑器',
    line: null,
    column: null,
    ...overrides,
  };
}

async function initializeViewModel(params: TextEditorViewModelParams) {
  const { value: viewModel } = mountSetup(() => useTextEditorViewModel(params));
  await viewModel.initialize();
  return viewModel;
}

function textApplied(event: { sessionId: string; modRoot: string; path: string; text: string; baseVersions: [] }) {
  const path = event.path.startsWith(event.modRoot) ? event.path : event.modRoot + '/' + event.path;
  const result = savedWriteFixture({ text: event.text }, { kind: 'text', path });
  result.baseVersions = [{ path, fingerprint: 'saved' }];
  void dispatchProjectChangeFixture(committedChangeFixture(result, event.sessionId, event.modRoot));
}
describe('useTextEditorViewModel loading', () => {
  it('keeps native input and close capture immutable and serializes once when saving', async () => {
    mocks.loadTextFile.mockResolvedValue(textFileFixture('x'.repeat(10485760)));
    const vm = await initializeViewModel(paramsFixture());
    const serialized = vi.spyOn(textDocument, 'writeTextContent');
    try {
      vm.document.dispatch(vm.document.state.value.update({ changes: { from: 0, insert: '中' } }));
      const accepts = vm.document.captureContent();
      expect(accepts()).toBe(true);
      expect(serialized).toHaveBeenCalledTimes(0);
      mocks.saveTextFile.mockResolvedValueOnce(savedWriteFixture());
      await vm.saveFile();
      expect(serialized).toHaveBeenCalledTimes(1);
    } finally {
      serialized.mockRestore();
      vm.dispose();
    }
  });
  it('edits a large text with scalar comparison and preserves the existing undo history', async () => {
    const original = 'x'.repeat(10 * 1024 * 1024);
    mocks.loadTextFile.mockResolvedValue(textFileFixture(original));
    const vm = await initializeViewModel(paramsFixture());
    const stringify = vi.spyOn(JSON, 'stringify');
    try {
      vm.updateText(original + '!');
      expect(vm.dirty.value).toBe(true);
      vm.undoEdit();
      expect(vm.text.value).toBe(original);
      expect(vm.dirty.value).toBe(false);
      vm.redoEdit();
      expect(vm.text.value).toBe(original + '!');
      expect(stringify.mock.calls.some(([value]) => typeof value === 'string' && value.length >= original.length)).toBe(false);
    } finally {
      stringify.mockRestore();
      vm.dispose();
    }
  });
  it.each([false, true])('refreshes disk once and preserves a dirty draft=%s', async (dirty) => {
    mocks.loadTextFile.mockResolvedValue(textFileFixture('base'));
    const vm = await initializeViewModel(paramsFixture());
    if (dirty) vm.updateText('draft');
    mocks.loadTextFile.mockClear();
    mocks.loadTextFile.mockResolvedValueOnce(textFileFixture('disk'));
    await vm.initialize();
    expect(mocks.loadTextFile).toHaveBeenCalledTimes(1);
    expect(vm.text.value).toBe(dirty ? 'draft' : 'disk');
    expect(vm.hasPendingExternalText.value).toBe(dirty);
    if (dirty) {
      vm.undoEdit();
      expect(vm.text.value).toBe('base');
      vm.redoEdit();
      expect(vm.text.value).toBe('draft');
      vm.loadPendingExternalText();
      await mocks.feedback.confirmWarning.mock.calls.at(-1)![0].onConfirm();
      expect(vm.text.value).toBe('disk');
    }
    vm.dispose();
  });
  it('keeps a draft on read failure and clears the error after retry', async () => {
    mocks.loadTextFile.mockResolvedValue(textFileFixture('base'));
    const vm = await initializeViewModel(paramsFixture());
    vm.updateText('draft');
    mocks.loadTextFile.mockRejectedValueOnce(new Error('access denied'));
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
    mocks.loadTextFile.mockResolvedValue(textFileFixture('base'));
    const vm = await initializeViewModel(paramsFixture());
    const pending = pendingRead();
    mocks.loadTextFile.mockReturnValueOnce(pending.promise);
    const older = vm.initialize();
    await flushPromises();
    await vm.initialize();
    if (completion === 'resolve') pending.resolve(textFileFixture('old'));
    else pending.reject(new Error('old failure'));
    await older;
    expect(vm.text.value).toBe('base');
    expect(vm.contextMessage.value).toBe('');
    vm.dispose();
  });
  it('loads the file text into the draft and tracks the line count', async () => {
    mocks.loadTextFile.mockResolvedValue(textFileFixture('line1\nline2'));
    const viewModel = await initializeViewModel(paramsFixture());
    expect(viewModel.text.value).toBe('line1\nline2');
    expect(viewModel.document.state.value.doc.lines).toBe(2);
    expect(viewModel.dirty.value).toBe(false);
    viewModel.dispose();
  });

  it('delivers initial read failure through its acceptance promise', async () => {
    mocks.loadTextFile.mockRejectedValue(new Error('unreadable'));
    await expect(initializeViewModel(paramsFixture())).rejects.toThrow('unreadable');
  });
  it('refuses to operate without a file path', async () => {
    await expect(initializeViewModel(paramsFixture({ filePath: null }))).rejects.toThrow('文件目标不可用');
    expect(mocks.feedback.error).toHaveBeenCalledWith('缺少文件路径');
  });
});

describe('useTextEditorViewModel editing', () => {
  async function loadedViewModel() {
    mocks.loadTextFile.mockResolvedValue(textFileFixture('base'));
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
    expect(vm.text.value).toBe('base');
    vm.redoEdit();
    expect(vm.text.value).toBe('one');
    vm.dispose();
    expect(vm.canUndo.value).toBe(false);
    useSettingsStore().setEditHistoryLimit(2);
    expect(vm.canRedo.value).toBe(false);
  });

  it('saves through the write service and records history only in session mode', async () => {
    const result = savedWriteFixture();
    mocks.saveTextFile.mockResolvedValue(result);
    const viewModel = await loadedViewModel();
    viewModel.updateText('saved text');
    await viewModel.saveFile();
    expect(mocks.saveTextFile).toHaveBeenCalledWith('s1', 'C:/mods/alpha', 'C:/mods/alpha/data/hulls/test.file', 'saved text', [], {
      id: 'fixture-save',
    });
    expect(mocks.publishCommittedWrite).toHaveBeenCalledTimes(1);
    expect(mocks.feedback.success).toHaveBeenCalledWith('文件已保存', { paths: ['C:/mods/alpha/data/hulls/test.file'] });
    expect(viewModel.dirty.value).toBe(false);
    viewModel.dispose();
  });

  it('writes recovery credentials and publishes their actual associated session updates', async () => {
    mocks.loadTextFile.mockResolvedValue(textFileFixture('base'));
    const viewModel = await initializeViewModel(paramsFixture({ mode: 'recovery', sessionId: null }));
    mocks.saveTextFile.mockResolvedValue(savedWriteFixture());
    viewModel.updateText('recovered');
    await viewModel.saveFile();
    expect(mocks.saveTextFile).toHaveBeenCalledWith(null, 'C:/mods/alpha', 'C:/mods/alpha/data/hulls/test.file', 'recovered', [], {
      id: 'fixture-save',
    });
    expect(mocks.publishCommittedWrite).toHaveBeenCalledWith('C:/mods/alpha', expect.any(Object), null);
    viewModel.dispose();
  });

  it('reports save failures and keeps the draft dirty', async () => {
    const viewModel = await loadedViewModel();
    mocks.saveTextFile.mockRejectedValue(new Error('locked'));
    viewModel.updateText('will fail');
    await viewModel.saveFile();
    expect(mocks.feedback.error).toHaveBeenCalledWith(expect.anything(), '保存文件失败');
    expect(viewModel.dirty.value).toBe(true);
    viewModel.dispose();
  });

  it('retains subsequent text and both history actions after accepting the written baseline', async () => {
    const vm = await loadedViewModel();
    let release!: (result: ReturnType<typeof savedWriteFixture<RowData>>) => void;
    mocks.saveTextFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    vm.updateText('submitted');
    const writing = vm.saveFile();
    vm.updateText('later');
    mocks.loadTextFile.mockClear();
    mocks.loadTextFile.mockResolvedValue(textFileFixture('submitted', { baseVersions: [{ path: 'file', fingerprint: 'v2' }] }));
    const reopening = vm.initialize();
    await flushPromises();
    expect(mocks.loadTextFile).toHaveBeenCalledTimes(0);
    release({ ...savedWriteFixture(), baseVersions: [{ path: 'file', fingerprint: 'v2' }] });
    await writing;
    await reopening;
    expect(mocks.loadTextFile).toHaveBeenCalledTimes(1);
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

describe('useTextEditorViewModel external text', () => {
  it('accepts a repaired source after the initial read failed', async () => {
    mocks.loadTextFile.mockRejectedValueOnce(new Error('source unavailable'));
    const { value: vm } = mountSetup(() => useTextEditorViewModel(paramsFixture()));
    await expect(vm.initialize()).rejects.toThrow('source unavailable');
    mocks.loadTextFile.mockResolvedValueOnce(textFileFixture('repaired'));
    await projectChangeFixture('s1', { ...savedWriteFixture().invalidation, paths: ['data/hulls/test.file'] }, 'C:/mods/alpha');
    expect(vm.contentReady.value).toBe(true);
    expect(vm.text.value).toBe('repaired');
    expect(vm.contextMessage.value).toBe('');
    vm.dispose();
  });
  it.each([false, true])('follows a reliable plain-file rename and retains text history when dirty=%s', async (dirty) => {
    const before = 'C:/mods/alpha/notes.txt',
      after = 'C:/mods/alpha/archive/notes.txt';
    mocks.loadTextFile.mockResolvedValueOnce(textFileFixture('baseline', { path: before }));
    const vm = await initializeViewModel(paramsFixture({ filePath: before }));
    if (dirty) vm.updateText('unfinished text');
    mocks.feedback.choose.mockResolvedValueOnce('follow');
    mocks.loadTextFile.mockResolvedValueOnce(textFileFixture('baseline', { path: after }));
    await projectChangeFixture(
      's1',
      { ...savedWriteFixture().invalidation, paths: [before, after], renames: [[before, after]] },
      'C:/mods/alpha',
    );
    expect(vm.filePath.value).toBe(after);
    expect(vm.text.value).toBe(dirty ? 'unfinished text' : 'baseline');
    expect(vm.dirty.value).toBe(dirty);
    if (dirty) {
      vm.undoEdit();
      expect(vm.text.value).toBe('baseline');
    }
    vm.dispose();
  });
  it.each([true, false])('uses a text receipt once with complete entity metadata=%s', async (complete) => {
    const target = entityTargetFixture('ship', 'probe', 'existing', 'C:/mods/alpha');
    const loaded = textFileFixture('base', { path: target.write.path, entity: { target, baseVersions: [] } });
    mocks.loadTextFile.mockResolvedValue(loaded);
    const vm = await initializeViewModel(paramsFixture({ filePath: target.write.path }));
    mocks.loadTextFile.mockClear();
    mocks.loadTextFile.mockResolvedValue({ ...loaded, text: 'external' });
    const result = savedWriteFixture({ text: 'external' }, { kind: 'text', path: target.write.path });
    result.baseVersions = [{ path: target.write.path, fingerprint: 'saved' }];
    result.invalidation.paths = [target.write.path];
    result.identityChanges = complete ? [{ before: target, after: target }] : [];
    void dispatchProjectChangeFixture(committedChangeFixture(result, 's1', 'C:/mods/alpha'));
    await flushPromises();
    expect(mocks.loadTextFile).toHaveBeenCalledTimes(complete ? 0 : 1);
    expect(vm.text.value).toBe('external');
    vm.dispose();
  });
  it('keeps unfinished text and follows its new identity after parsing becomes possible', async () => {
    const before = entityTargetFixture('ship', 'old');
    const after = entityTargetFixture('ship', 'new');
    mocks.loadTextFile.mockResolvedValueOnce(
      textFileFixture("{hullId:'old'}", { path: before.write.path, entity: { target: before, baseVersions: [] } }),
    );
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
    mocks.loadTextFile.mockResolvedValueOnce(
      textFileFixture('{hullId:"new"}', { path: after.write.path, entity: { target: after, baseVersions: [] } }),
    );
    vm.updateText("{hullId:'old', extra: 2}");
    await vi.waitFor(() => expect(vm.filePath.value).toBe(after.write.path));
    expect(vm.text.value).toBe('{hullId:"new", extra: 2}');
    expect(vm.dirty.value).toBe(true);
    expect(vm.externalTextNotice.value).toBe('');
    expect(vm.canUndo.value).toBe(false);
    vm.dispose();
  });
  it('discards an external read superseded by the local save', async () => {
    mocks.loadTextFile.mockResolvedValueOnce(textFileFixture('base', { path: 'C:/mods/alpha/notes.txt' }));
    const vm = await initializeViewModel(paramsFixture({ filePath: 'C:/mods/alpha/notes.txt' }));
    let release!: (loaded: TextFileData) => void;
    mocks.loadTextFile.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const reading = projectChangeFixture('s1', { ...savedWriteFixture().invalidation, ...{ paths: ['notes.txt'] } }, 'C:/mods/alpha');
    vm.updateText('saved B');
    mocks.saveTextFile.mockResolvedValueOnce({ ...savedWriteFixture({ text: 'saved B' }), changes: [], baseVersions: [] });
    await vm.saveFile();
    release(textFileFixture('older A'));
    await reading;
    expect(vm.text.value).toBe('saved B');
    expect(vm.dirty.value).toBe(false);
    vm.dispose();
  });
  it.each(['data/hulls/test.file', 'data/hulls', 'C:/mods/alpha/data/hulls/test.file'])(
    'stages a dirty file version from the invalidation path %s',
    async (path) => {
      mocks.loadTextFile.mockResolvedValueOnce(textFileFixture('base'));
      const viewModel = await initializeViewModel(paramsFixture({ filePath: 'C:/mods/alpha/data/hulls/test.file' }));
      viewModel.updateText('local');
      mocks.loadTextFile.mockResolvedValueOnce(textFileFixture('external'));
      await projectChangeFixture('s1', { ...savedWriteFixture().invalidation, ...{ paths: [path] } }, 'C:/mods/alpha');
      await flushPromises();
      expect(mocks.loadTextFile).toHaveBeenLastCalledWith('s1', 'C:/mods/alpha', 'C:/mods/alpha/data/hulls/test.file');
      expect(viewModel.text.value).toBe('local');
      expect(viewModel.hasPendingExternalText.value).toBe(true);
      viewModel.loadPendingExternalText();
      await mocks.feedback.confirmWarning.mock.calls.at(-1)![0].onConfirm();
      expect(viewModel.text.value).toBe('external');
      viewModel.dispose();
    },
  );

  it('stages external text while dirty and shows the notice', async () => {
    mocks.loadTextFile.mockResolvedValue(textFileFixture('base'));
    const viewModel = await initializeViewModel(paramsFixture());
    viewModel.updateText('local edit');
    textApplied!({ sessionId: 's1', modRoot: 'C:/mods/alpha', path: 'data/hulls/test.file', text: 'external', baseVersions: [] });

    expect(viewModel.dirty.value).toBe(true);
    expect(viewModel.text.value).toBe('local edit');
    expect(viewModel.hasPendingExternalText.value).toBe(true);
    expect(viewModel.externalTextNotice.value).toContain('外部文本已更新');

    viewModel.loadPendingExternalText();
    await mocks.feedback.confirmWarning.mock.calls.at(-1)![0].onConfirm();
    expect(viewModel.text.value).toBe('external');
    expect(viewModel.hasPendingExternalText.value).toBe(false);
    viewModel.dispose();
  });

  it('applies external text directly when clean and filters foreign targets', async () => {
    mocks.loadTextFile.mockResolvedValue(textFileFixture('base'));
    const viewModel = await initializeViewModel(paramsFixture());
    textApplied!({ sessionId: 'other', modRoot: 'C:/mods/alpha', path: 'data/hulls/test.file', text: 'foreign', baseVersions: [] });
    expect(viewModel.text.value).toBe('base');

    textApplied!({ sessionId: 's1', modRoot: 'C:/mods/alpha', path: 'data/hulls/test.file', text: 'fresh', baseVersions: [] });
    expect(viewModel.text.value).toBe('fresh');
    expect(viewModel.hasPendingExternalText.value).toBe(false);
    viewModel.dispose();
  });

  it('updates location independently of the current text and errors', async () => {
    mocks.loadTextFile.mockResolvedValue(textFileFixture('base'));
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
  mocks.loadTextFile.mockReturnValueOnce(pending.promise);
  const wrapper = mount(TextEditorContent, { global: { stubs: { 'n-button': nButton, TextEditorSurface: textEditorSurface } } });
  const request = windowFixture();
  const opening = mocks.request!(request);
  await flushPromises();
  expect(wrapper.get('.text-editor-status').text()).toBe('正在读取文件…');
  const error = {
    code: 'text.invalid_utf8',
    message: 'invalid bytes',
    location: { path: request.identity.path, line: null, column: null },
  };
  pending.reject(error);
  await expect(opening).rejects.toEqual(error);
  await flushPromises();
  expect(wrapper.get('.text-editor-message.danger').text()).toContain('请选择文件当前使用的编码');
  expect(wrapper.findAll('button').map((button) => button.text())).toContain('重试');
  expect(mocks.feedback.error).toHaveBeenLastCalledWith(error, '读取文件失败');
  mocks.loadTextFile.mockRejectedValueOnce(error);
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '重试')!
    .trigger('click');
  await flushPromises();
  expect(mocks.feedback.error).toHaveBeenCalledTimes(2);
  expect(wrapper.get('.text-editor-status').text()).toBe('读取失败');
  mocks.loadTextFile.mockResolvedValueOnce(textFileFixture('first\nsecond'));
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '重试')!
    .trigger('click');
  await flushPromises();
  expect(mocks.loadTextFile).toHaveBeenCalledTimes(3);
  expect(wrapper.find('.text-editor-message').exists()).toBe(false);
  expect(wrapper.getComponent(TextEditorSurface).props('document').state.value.doc.toString()).toBe('first\nsecond');
  expect(wrapper.getComponent(TextEditorSurface).props('document').state.value.selection.main.head).toBe(6);
  expect(wrapper.getComponent(TextEditorSurface).props('line')).toBe(2);
});

vi.mock('@/services/text-editor.service', () => ({ followTextIdentity: mocks.followIdentity }));
