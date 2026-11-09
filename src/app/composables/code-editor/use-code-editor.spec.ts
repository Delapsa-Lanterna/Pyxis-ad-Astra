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
import { projectChangeFixture, projectChangeListeners } from '@/test/unit/project-changes';
import type { loadEditableFileData, writeEditableFileText } from '@/services/files.service';
import type { AppFeedback, CodeEditorDelivery, CodeEditorFileResult, EditableFileData } from '@/shared/types';
import { useCodeEditor } from './use-code-editor';

const mocks = vi.hoisted(() => ({
  load: vi.fn<typeof loadEditableFileData>(),
  write: vi.fn<typeof writeEditableFileText>(),
  receive: null as ((delivery: CodeEditorDelivery) => void) | null,
  receipts: vi.fn<(key: string, results: CodeEditorFileResult[]) => Promise<void>>(async () => {}),
  feedback: {
    success: vi.fn(),
    error: vi.fn(),
    choose: vi.fn<AppFeedback['choose']>(),
    confirmWarning: vi.fn<AppFeedback['confirmWarning']>(),
  },
}));
vi.mock('@/services/files.service', () => ({ loadEditableFileData: mocks.load, writeEditableFileText: mocks.write }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => mocks.feedback }));
vi.mock('@/services/code-editor.service', () => ({
  subscribeCodeEditor: async (receive: (delivery: CodeEditorDelivery) => void) => {
    mocks.receive = receive;
  },
  finishCodeEditorOpen: mocks.receipts,
}));
vi.mock('@/orchestrators/project-sync.orchestrator', async () => await import('@/test/unit/project-changes'));
vi.mock('@/app/composables/code-editor/use-code-editor-window', () => ({
  useCodeEditorWindow: () => ({ ...useCodeEditor(owner), closing: ref(false) }),
}));
vi.mock('@/app/composables/use-window-shortcuts', () => ({ useWindowShortcuts: () => {} }));
enableAutoUnmount(afterEach);
const owner = { sessionId: 'sample-session', modRoot: 'M:/sample' };
function loaded(path: string, text = 'class Sample {}\r\n'): EditableFileData {
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
  it('selects once after a multi-file batch and clears the view before releasing its documents', async () => {
    const { value: host, wrapper } = mountSetup(() => useCodeEditor(owner));
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
  it('writes the native text once per switch and retains the native selection during input', async () => {
    const wrapper = mount(CodeEditorContent, {
      attachTo: document.body,
      global: { stubs: { NButton: { template: '<button><slot /></button>' } } },
    });
    await flushPromises();
    mocks.load.mockImplementation(async (_s, _r, path) => loaded(path, path.endsWith('A.java') ? 'alpha\r\nbeta' : 'other'));
    mocks.receive!({ key: 'view', files: [{ path: 'M:/sample/A.java' }, { path: 'M:/sample/B.java' }] });
    await flushPromises();
    const textarea = wrapper.get('textarea').element;
    const writes = vi.spyOn(HTMLTextAreaElement.prototype, 'value', 'set');
    try {
      await wrapper.findAll('[role="tab"]')[0]!.trigger('click');
      await flushPromises();
      expect(writes).toHaveBeenCalledTimes(1);
      expect(textarea.value).toBe('alpha\nbeta');
      textarea.setSelectionRange(6, 6);
      await wrapper.get('textarea').trigger('beforeinput', { inputType: 'insertText' });
      textarea.setRangeText('中', 6, 6, 'end');
      await wrapper.get('textarea').trigger('input');
      await flushPromises();
      expect(textarea.value).toBe('alpha\n中beta');
      expect(textarea.selectionStart).toBe(7);
      expect(writes).toHaveBeenCalledTimes(1);
      await wrapper.findAll('[role="tab"]')[1]!.trigger('click');
      await wrapper.findAll('[role="tab"]')[0]!.trigger('click');
      await flushPromises();
      expect(textarea.value).toBe('alpha\n中beta');
      expect(textarea.selectionStart).toBe(7);
    } finally {
      writes.mockRestore();
    }
  });
  it('releases an in-flight document read when the window is destroyed', async () => {
    const { value: host, wrapper } = mountSetup(() => useCodeEditor(owner));
    await host.ready;
    let complete!: (value: EditableFileData) => void;
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
    const { value: host, wrapper } = mountSetup(() => useCodeEditor(owner));
    await host.ready;
    await host.openFiles([{ path: 'M:/sample/a/Entry.java' }, { path: 'M:/sample/b/Entry.java' }]);
    const [first, second] = host.documents;
    first!.setText('first');
    second!.setText('second');
    first!.view.start = 3;
    for (let index = 0; index < 100; index++) host.active.value = index % 2 ? first! : second!;
    await host.openFiles([{ path: first!.path.value, line: 1, column: 3 }]);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(host.documents).toHaveLength(2);
    expect(host.label(first!)).toBe('a/Entry.java');
    first!.undo();
    expect(first!.session.draftValue.value).toBe('class Sample {}\r\n');
    expect(second!.session.draftValue.value).toBe('second');
    wrapper.unmount();
    expect(useSaveCommandStore().editTargets).toHaveLength(0);
    expect(projectChangeListeners.size).toBe(0);
  });
  it('delivers queued batches in order and continues after a failed file', async () => {
    const { value: host } = mountSetup(() => useCodeEditor(owner));
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
    const { value: host } = mountSetup(() => useCodeEditor(owner));
    await host.ready;
    await host.openFiles([{ path: 'M:/sample/A.java' }, { path: 'M:/sample/B.java' }]);
    const first = host.documents[0]!;
    first.setText('submitted');
    let complete!: (value: Awaited<ReturnType<typeof writeEditableFileText>>) => void;
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
    expect(first.session.draftValue.value).toBe('later');
    expect(first.session.baselineSnapshot.value!.value).toBe('submitted');
    expect(first.session.dirty.value).toBe(true);
  });
  it('accepts background external updates, retains dirty drafts and follows a moved file', async () => {
    const { value: host } = mountSetup(() => useCodeEditor(owner));
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
    expect(first.session.draftValue.value).toBe('draft');
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
    expect(first.session.draftValue.value).toBe('draft');
    expect(first.problem.value).toBeNull();
  });
  it('closes adjacent tabs, preserves canceled or failed saves and ends at an empty view', async () => {
    const { value: host } = mountSetup(() => useCodeEditor(owner));
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
