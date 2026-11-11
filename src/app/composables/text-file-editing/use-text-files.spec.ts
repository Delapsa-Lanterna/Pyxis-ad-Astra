import { useTextFileBatch } from '@/app/composables/text-file-editing/use-text-file-batch';
import { useCodeFileRequests } from '@/app/composables/code-editor/use-code-file-requests';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { ref, watch } from 'vue';
import CodeEditorContent from '@/app/components/code-editor/CodeEditorContent.vue';
import { createPinia, setActivePinia } from 'pinia';
import { mountSetup } from '@/test/unit/mount-setup';
import { initializeSettingsStore } from '@/stores/settings.store';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { savedWriteFixture } from '@/test/fixtures/write-result';
import {
  projectChangeFixture,
  projectChangeListeners,
  committedChangeFixture,
  dispatchProjectChangeFixture,
} from '@/test/unit/project-changes';
import type { loadTextFile, saveTextFile } from '@/services/text-file-editing.service';
import type { AppFeedback, CodeEditorDelivery, TextFileOpenResult, TextFileData } from '@/shared/types';
import TextEditorSurface from '@/shared/ui/TextEditorSurface.vue';
import { textEditorSurface } from '@/test/unit/text-editor-surface';
import { writeTextContent } from '@/shared/runtime/text-document';
import * as textDocument from '@/shared/runtime/text-document';
import { useTextFiles } from '@/app/composables/text-file-editing/use-text-files';
import { useJavaEditor } from '@/app/composables/java-analysis/use-java-editor';
import { useJavaActions } from '@/app/composables/java-analysis/use-java-actions';
import { Transaction } from '@codemirror/state';

const mocks = vi.hoisted(() => ({
  load: vi.fn<typeof loadTextFile>(),
  write: vi.fn<typeof saveTextFile>(),
  receive: null as ((delivery: CodeEditorDelivery) => void) | null,
  receipts: vi.fn<(key: string, results: TextFileOpenResult[]) => Promise<void>>(async () => {}),
  feedback: {
    success: vi.fn(),
    error: vi.fn(),
    choose: vi.fn<AppFeedback['choose']>(),
    confirmWarning: vi.fn<AppFeedback['confirmWarning']>(),
  },
}));
vi.mock('@/services/text-file-editing.service', () => ({ loadTextFile: mocks.load, saveTextFile: mocks.write }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => mocks.feedback }));
vi.mock('@/services/code-editor.service', () => ({
  subscribeCodeEditor: async (receive: (delivery: CodeEditorDelivery) => void) => {
    mocks.receive = receive;
  },
  finishCodeEditorOpen: mocks.receipts,
}));
vi.mock('@/orchestrators/project-sync.orchestrator', async () => await import('@/test/unit/project-changes'));
vi.mock('@/app/composables/code-editor/use-code-editor-window', () => ({
  useCodeEditorWindow: () => {
    const host = createHost();
    const analysis = useJavaEditor(host, owner.modRoot);
    return {
      ...host,
      analysis,
      actions: useJavaActions(host, analysis, useTextFileBatch(host, owner).apply),
      closing: ref(false),
      project: undefined,
    };
  },
}));
vi.mock('@/services/java-analysis.service', () => ({
  closeJavaEditor: async () => {},
  startJavaEditor: async () => {},
  syncJavaEditor: async () => {},
  inspectJavaEditor: async () => ({ diagnostics: [], outline: [], locations: [] }),
}));
vi.mock('@/app/composables/use-window-shortcuts', () => ({ useWindowShortcuts: () => {} }));
enableAutoUnmount(afterEach);
afterEach(() => vi.unstubAllGlobals());
const owner = { sessionId: 'sample-session', modRoot: 'M:/sample' };
function loaded(path: string, text = 'class Sample {}\r\n'): TextFileData {
  return { path, text, entity: null, baseVersions: [{ path, fingerprint: 'sample-version' }] };
}
beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  mocks.load.mockImplementation(async (_session, _root, path) => loaded(path));
  mocks.write.mockImplementation(async (_session, _root, path, text) => ({
    ...savedWriteFixture({ text }, { kind: 'text', path }),
    baseVersions: [{ path, fingerprint: 'saved-version' }],
  }));
  mocks.feedback.choose.mockResolvedValue(null);
});
describe('code editor document host', () => {
  it('accepts one changed file without rereading the other 49 documents or changing their histories', async () => {
    const { value: host } = mountSetup(() => createHost());
    await host.ready;
    await host.openFiles(Array.from({ length: 50 }, (_, index) => ({ path: `M:/sample/File${index}.txt` })));
    const first = host.documents[0]!,
      other = host.documents[1]!;
    other.setText('local draft');
    const states = host.documents.slice(1).map((file) => file.document.state.value);
    mocks.load.mockClear();
    const result = savedWriteFixture({ text: 'peer saved' }, { kind: 'text', path: first.path.value });
    result.baseVersions = [{ path: first.path.value, fingerprint: 'peer' }];
    result.invalidation = { ...result.invalidation, paths: [first.path.value], session: false };
    await dispatchProjectChangeFixture(committedChangeFixture(result, owner.sessionId, owner.modRoot));
    expect(writeTextContent(first.session.draftValue.value)).toBe('peer saved');
    expect(mocks.load).toHaveBeenCalledTimes(0);
    expect(host.documents.slice(1).map((file) => file.document.state.value)).toEqual(states);
    other.undo();
    expect(writeTextContent(other.session.draftValue.value)).toBe('class Sample {}\r\n');
    await projectChangeFixture(owner.sessionId, { ...result.invalidation, paths: ['M:/sample/File2.txt'] }, owner.modRoot);
    expect(mocks.load).toHaveBeenCalledTimes(1);
    await projectChangeFixture(owner.sessionId, { ...result.invalidation, paths: [], session: true }, owner.modRoot);
    expect(mocks.load).toHaveBeenCalledTimes(51);
  });
  it.each(['finish', 'dispose'] as const)('settles composition before save capture and releases on %s', async (outcome) => {
    const { value: host, wrapper } = mountSetup(() => createHost());
    await host.ready;
    await host.openFiles([{ path: 'M:/sample/Composition.java' }]);
    const file = host.documents[0]!,
      document = file.document;
    document.startComposition();
    document.dispatch(
      document.state.value.update({
        changes: { from: 0, insert: '中' },
        annotations: Transaction.userEvent.of('input.type.compose.start'),
      }),
    );
    const saving = host.save(file),
      repeated = host.save(file);
    expect(mocks.write).toHaveBeenCalledTimes(0);
    if (outcome === 'dispose') {
      wrapper.unmount();
      expect(await saving).toBe(false);
      expect(await repeated).toBe(false);
      expect(mocks.write).toHaveBeenCalledTimes(0);
      return;
    }
    document.dispatch(
      document.state.value.update({
        changes: { from: 0, to: 1, insert: '中文' },
        annotations: Transaction.userEvent.of('input.type.compose'),
      }),
    );
    document.finishComposition();
    await Promise.all([saving, repeated]);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls[0]![3]).toBe('中文class Sample {}\r\n');
    document.dispatch(
      document.state.value.update({ changes: { from: 0, insert: 'next' }, annotations: Transaction.userEvent.of('input.type') }),
    );
    file.undo();
    expect(writeTextContent(file.session.draftValue.value)).toBe('中文class Sample {}\r\n');
  });
  it('captures a save immediately when no composition is pending', async () => {
    const { value: host } = mountSetup(() => createHost());
    await host.ready;
    await host.openFiles([{ path: 'M:/sample/Capture.java' }]);
    const file = host.documents[0]!;
    file.setText('submitted');
    const saving = host.save(file);
    file.setText('later');
    await saving;
    expect(mocks.write.mock.calls[0]![3]).toBe('submitted');
    expect(writeTextContent(file.session.draftValue.value)).toBe('later');
  });
  it('generates full text only on save, including large edits, switches and close capture', async () => {
    const { value: host } = mountSetup(() => createHost());
    await host.ready;
    mocks.load.mockImplementation(async (_s, _r, path) => loaded(path, 'x'.repeat(path.endsWith('0.java') ? 10485760 : 102400)));
    await host.openFiles(Array.from({ length: 50 }, (_, index) => ({ path: `M:/sample/${index}.java` })));
    const serialized = vi.spyOn(textDocument, 'writeTextContent');
    try {
      for (const file of host.documents) {
        file.document.dispatch(file.document.state.value.update({ changes: { from: 0, insert: '中' } }));
        host.active.value = file;
      }
      const accepts = useSaveCommandStore().captureCloseState();
      expect(accepts()).toBe(true);
      expect(serialized).toHaveBeenCalledTimes(0);
      const first = host.documents[0]!;
      await host.save(first);
      expect(serialized).toHaveBeenCalledTimes(1);
      first.document.dispatch(first.document.state.value.update({ changes: { from: 0, insert: '后' } }));
      expect(accepts()).toBe(false);
      expect(serialized).toHaveBeenCalledTimes(1);
    } finally {
      serialized.mockRestore();
    }
  });
  it('selects once after a multi-file batch and clears the view before releasing its documents', async () => {
    const { value: host, wrapper } = mountSetup(() => createHost());
    await host.ready;
    const selected: Array<string | null> = [];
    const stop = watch(host.active, (document) => selected.push(document?.path.value ?? null), { flush: 'sync' });
    try {
      await host.openFiles(Array.from({ length: 50 }, (_, index) => ({ path: `M:/sample/Entry${index}.java` })));
      expect(selected).toEqual(['M:/sample/Entry49.java']);
      wrapper.unmount();
      expect(selected).toEqual(['M:/sample/Entry49.java', null]);
      expect(useSaveCommandStore().editTargets).toHaveLength(0);
    } finally {
      stop();
    }
  });
  it('binds independent document states to one input surface across tab switches', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const wrapper = mount(CodeEditorContent, {
      global: {
        stubs: {
          NButton: { template: '<button><slot /></button>' },
          NInput: true,
          NSelect: true,
          NPopover: { template: '<div><slot name="trigger"/><slot /></div>' },
          NSplit: { template: '<div><slot name="1"/><slot name="2"/></div>' },
          TextEditorSurface: textEditorSurface,
        },
      },
    });
    await flushPromises();
    mocks.receive!({ key: 'view', files: [{ path: 'M:/sample/A.java' }, { path: 'M:/sample/B.java' }] });
    await flushPromises();
    const surface = wrapper.getComponent(TextEditorSurface);
    expect(wrapper.get('[aria-label="展开大纲"]').attributes('aria-pressed')).toBe('false');
    await wrapper.get('[aria-label="展开大纲"]').trigger('click');
    expect(wrapper.get('[aria-label="收起大纲"]').attributes('aria-pressed')).toBe('true');
    const second = surface.props('document');
    await wrapper.findAll('[role="tab"]')[0]!.trigger('click');
    const first = surface.props('document');
    first.dispatch(first.state.value.update({ changes: { from: 0, insert: '中' }, selection: { anchor: 1 } }));
    const state = first.state.value;
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click');
    expect(surface.props('document')).toBe(second);
    await wrapper.findAll('[role="tab"]')[0]!.trigger('click');
    expect(surface.props('document').state.value).toBe(state);
    expect(state.selection.main.head).toBe(1);
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it('reopens the same file after discarding and replaces its released text state', async () => {
    const { value: host } = mountSetup(() => createHost());
    await host.ready;
    await host.openFiles([{ path: 'M:/sample/Neighbor.java' }, { path: 'M:/sample/Reopen.java' }]);
    const old = host.active.value!;
    old.setText('changed');
    mocks.feedback.choose.mockResolvedValueOnce('discard');
    await host.close(old);
    await host.openFiles([{ path: 'M:/sample/Reopen.java' }]);
    expect(host.active.value).not.toBe(old);
    expect(host.active.value!.document.state.value.doc.toString()).toBe('class Sample {}\n');
    host.active.value!.document.locate(1, 7);
    expect(host.active.value!.document.state.value.selection.main.head).toBe(6);
  });
  it('releases an in-flight document read when the window is destroyed', async () => {
    const { value: host, wrapper } = mountSetup(() => createHost());
    await host.ready;
    let complete!: (value: TextFileData) => void;
    mocks.load.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const opening = host.openFiles([{ path: 'M:/sample/Deferred.java' }]);
    await flushPromises();
    wrapper.unmount();
    await opening;
    expect(host.documents).toHaveLength(0);
    expect(useSaveCommandStore().editTargets).toHaveLength(0);
    complete(loaded('M:/sample/Deferred.java'));
    await flushPromises();
    expect(host.documents).toHaveLength(0);
  });
  it('reuses loaded documents and keeps independent history and view across switches', async () => {
    const { value: host, wrapper } = mountSetup(() => createHost());
    await host.ready;
    await host.openFiles([{ path: 'M:/sample/a/Entry.java' }, { path: 'M:/sample/b/Entry.java' }]);
    const [first, second] = host.documents;
    first!.setText('first');
    second!.setText('second');
    first!.document.locate(1, 4);
    for (let index = 0; index < 100; index++) host.active.value = index % 2 ? first! : second!;
    await host.openFiles([{ path: first!.path.value, line: 1, column: 3 }]);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(host.documents).toHaveLength(2);
    expect(host.label(first!)).toBe('a/Entry.java');
    first!.undo();
    expect(writeTextContent(first!.session.draftValue.value)).toBe('class Sample {}\r\n');
    expect(writeTextContent(second!.session.draftValue.value)).toBe('second');
    wrapper.unmount();
    expect(useSaveCommandStore().editTargets).toHaveLength(0);
    expect(projectChangeListeners.size).toBe(0);
  });
  it('delivers queued batches in order and continues after a failed file', async () => {
    const { value: host } = mountSetup(() => createHost());
    await host.ready;
    mocks.load.mockImplementation(async (_s, _r, path) => {
      if (path.endsWith('Missing.java')) throw new Error('sample read failed');
      return loaded(path);
    });
    mocks.receive!({ key: 'batch-first', files: [{ path: 'M:/sample/A.java' }, { path: 'M:/sample/Missing.java' }] });
    mocks.receive!({ key: 'batch-next', files: [{ path: 'M:/sample/B.java' }] });
    await flushPromises();
    await host.settle();
    expect(host.documents.map((doc) => doc.path.value)).toEqual(['M:/sample/A.java', 'M:/sample/B.java']);
    expect(mocks.receipts.mock.calls.map(([key]) => key)).toEqual(['batch-first', 'batch-next']);
    expect(mocks.receipts.mock.calls[0]![1][1]!.diagnostic!.message).toContain('sample read failed');
  });
  it('saves the original document once and retains later input after switching tabs', async () => {
    const { value: host } = mountSetup(() => createHost());
    await host.ready;
    await host.openFiles([{ path: 'M:/sample/A.java' }, { path: 'M:/sample/B.java' }]);
    const first = host.documents[0]!;
    first.setText('submitted');
    const submitted = first.session.draftValue.value;
    let complete!: (value: Awaited<ReturnType<typeof saveTextFile>>) => void;
    mocks.write.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const saving = host.save(first);
    const repeated = host.save(first);
    await flushPromises();
    first.setText('later');
    host.active.value = host.documents[1]!;
    complete({
      ...savedWriteFixture({ text: 'submitted' }, { kind: 'text', path: first.path.value }),
      baseVersions: [{ path: first.path.value, fingerprint: 'saved' }],
    });
    await Promise.all([saving, repeated]);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(writeTextContent(first.session.draftValue.value)).toBe('later');
    expect(writeTextContent(first.session.baselineSnapshot.value!.value)).toBe('submitted');
    expect(first.session.baselineSnapshot.value!.value).toBe(submitted);
    expect(first.session.dirty.value).toBe(true);
  });
  it('accepts background external updates, retains dirty drafts and follows a moved file', async () => {
    const { value: host } = mountSetup(() => createHost());
    await host.ready;
    await host.openFiles([{ path: 'M:/sample/A.java' }, { path: 'M:/sample/B.java' }]);
    const first = host.documents[0]!;
    first.setText('draft');
    mocks.load.mockRejectedValueOnce(new Error('sample file temporarily absent'));
    await projectChangeFixture(
      owner.sessionId,
      { paths: ['A.java'], tables: [], entities: [], resources: [], queryScopes: [], session: false },
      owner.modRoot,
    );
    expect(first.problem.value?.message).toContain('temporarily absent');
    mocks.load.mockImplementation(async (_s, _r, path) => loaded(path, 'external'));
    await projectChangeFixture(
      owner.sessionId,
      { paths: ['A.java'], tables: [], entities: [], resources: [], queryScopes: [], session: false },
      owner.modRoot,
    );
    expect(writeTextContent(first.session.draftValue.value)).toBe('draft');
    expect(first.session.hasPendingExternalValue.value).toBe(true);
    mocks.feedback.choose.mockResolvedValueOnce('follow');
    await projectChangeFixture(
      owner.sessionId,
      {
        paths: [],
        tables: [],
        entities: [],
        resources: [],
        queryScopes: [],
        session: false,
        renames: [['M:/sample/A.java', 'M:/sample/sub/C.java']],
      },
      owner.modRoot,
    );
    expect(first.path.value).toBe('M:/sample/sub/C.java');
    expect(writeTextContent(first.session.draftValue.value)).toBe('draft');
    expect(first.problem.value).toBeNull();
  });
  it('closes adjacent tabs, preserves canceled or failed saves and ends at an empty view', async () => {
    const { value: host } = mountSetup(() => createHost());
    await host.ready;
    await host.openFiles(['A', 'B', 'C'].map((name) => ({ path: `M:/sample/${name}.java` })));
    const [first, middle, last] = host.documents;
    middle!.setText('modified');
    host.active.value = middle!;
    await host.close(middle!);
    expect(host.documents).toHaveLength(3);
    mocks.feedback.choose.mockResolvedValueOnce('save');
    mocks.write.mockRejectedValueOnce(new Error('sample write failed'));
    await expect(host.close(middle!)).rejects.toThrow('sample write failed');
    expect(host.documents).toHaveLength(3);
    mocks.feedback.choose.mockResolvedValueOnce('discard');
    await host.close(middle!);
    expect(host.active.value).toBe(last);
    await host.close(last!);
    expect(host.active.value).toBe(first);
    await host.close(first!);
    expect(host.active.value).toBeNull();
  });
});

function createHost() {
  const host = useTextFiles(owner);
  return { ...host, ready: useCodeFileRequests(host, host.ready) };
}
