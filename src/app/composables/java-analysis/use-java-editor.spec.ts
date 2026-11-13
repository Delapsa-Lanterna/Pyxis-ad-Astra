import { useCodeAnalysisSync } from '@/app/composables/code-editor/use-code-analysis-sync';
import { useTextFileBatch } from '@/app/composables/text-file-editing/use-text-file-batch';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Transaction } from '@codemirror/state';
import { ref } from 'vue';
import { mountSetup } from '@/test/unit/mount-setup';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { initializeSettingsStore } from '@/stores/settings.store';
import { useTextFiles } from '@/app/composables/text-file-editing/use-text-files';
import { useJavaEditor } from '@/app/composables/java-analysis/use-java-editor';
import { useJavaActions } from '@/app/composables/java-analysis/use-java-actions';
import type { startJavaEditor, syncJavaEditor, inspectJavaEditor, assistJavaEditor } from '@/services/java-analysis.service';
import type { JavaInspection, JavaAssistance } from '@/shared/types';
import { showTooltip } from '@codemirror/view';
import { startCompletion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { onTestFinished } from 'vitest';
import type * as AppLogQueueModule from '@/shared/runtime/app-log-queue';
import { projectChangeFixture } from '@/test/unit/project-changes';

const mocks = vi.hoisted(() => ({
  start: vi.fn<typeof startJavaEditor>(),
  sync: vi.fn<typeof syncJavaEditor>(),
  inspect: vi.fn<typeof inspectJavaEditor>(),
  assist: vi.fn<typeof assistJavaEditor>(),
  close: vi.fn(async () => {}),
  log: vi.fn(),
}));
vi.mock('@/shared/runtime/app-log-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof AppLogQueueModule>()),
  recordQueuedLog: mocks.log,
}));
vi.mock('@/services/java-analysis.service', () => ({
  startJavaEditor: mocks.start,
  syncJavaEditor: mocks.sync,
  inspectJavaEditor: mocks.inspect,
  assistJavaEditor: mocks.assist,
  closeJavaEditor: mocks.close,
}));
vi.mock('@/services/text-file-editing.service', () => ({
  loadTextFile: async (_session: string, _root: string, path: string) => {
    if (path.endsWith('/Absent.java')) throw Error('sample file unavailable');
    return {
      path,
      text: '// 星🪐\r\nclass Orbit {}',
      entity: null,
      baseVersions: [],
    };
  },
}));
vi.mock('@/services/code-editor.service', () => ({ subscribeCodeEditor: async () => {}, finishCodeEditorOpen: async () => {} }));
vi.mock('@/orchestrators/project-sync.orchestrator', async () => await import('@/test/unit/project-changes'));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn(), choose: async () => 'discard' }) }));
enableAutoUnmount(afterEach);
beforeEach(() => {
  vi.clearAllMocks();
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  mocks.start.mockResolvedValue();
  mocks.sync.mockResolvedValue();
  mocks.inspect.mockImplementation(async (file, _offset, purpose) => ({
    purpose,
    project: 'session:sample',
    revision: 2,
    file,
    version: 2,
    source: null,
    origin: null,
    binding: null,
    diagnostics: [],
    outline: [],
    locations: [],
  }));
});
afterEach(() => {
  vi.useRealTimers();
});
async function open() {
  const mounted = mountSetup(() => {
    const host = useTextFiles({ sessionId: 'sample', modRoot: 'M:/sample' });
    const analysis = useJavaEditor(host, 'M:/sample');
    useCodeAnalysisSync(analysis.refresh);
    return {
      host,
      analysis,
      actions: useJavaActions(host, analysis, useTextFileBatch(host, { sessionId: 'sample', modRoot: 'M:/sample' }).apply),
    };
  });
  await mounted.value.host.ready;
  await mounted.value.host.openFiles([{ path: 'M:/sample/src/Orbit.java' }]);
  return { ...mounted, ...mounted.value, document: mounted.value.host.active.value! };
}
it('queries the clicked import name using its raw CRLF offset and preserves the old selection', async () => {
  const { analysis, document } = await open();
  document.setText('// 星🪐\r\nimport pkg.Library;\r\nclass Orbit {}');
  await analysis.start();
  document.document.locate(3, 7);
  const before = document.document.state.value.selection;
  await analysis.navigate('declaration', 17);
  expect(mocks.inspect).toHaveBeenLastCalledWith(document.path.value, 18, 'declaration');
  expect(document.document.state.value.selection).toBe(before);
});

it('ends cancelled completion before it reaches the JVM queue and skips unavailable analysis', async () => {
  const { analysis } = await open();
  expect(await analysis.assist('complete', 6)).toBeNull();
  await analysis.start();
  const blocking = analysis.refresh();
  let current = true;
  const pending = analysis.assist('complete', 6, null, {}, 0, () => current);
  current = false;
  await blocking;
  expect(await pending).toBeNull();
  expect(mocks.assist).not.toHaveBeenCalled();
});

it('uses the engine source extension and refreshes parameters after typed delimiters', async () => {
  const frames = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
  onTestFinished(() => frames.mockRestore());
  const { analysis, actions, document } = await open();
  expect(analysis.supports({ ...document, path: ref('M:/sample/src/Orbit.JAVA') })).toBe(false);
  document.setText('class Orbit {void run(){call}}');
  await analysis.start();
  mocks.assist.mockResolvedValue({
    assistance: true,
    purpose: 'signature',
    project: 'sample',
    revision: 2,
    version: 2,
    file: document.path.value,
    argument: 0,
    files: [],
    choices: [],
    conflicts: [],
    candidates: [{ label: 'call', text: 'call()', detail: 'void (int)', from: 0, to: 0, relevance: 1 }],
  });
  document.document.configureSurface(actions.extensions.value);
  const view = new EditorView({
    state: document.document.state.value,
    dispatchTransactions(transactions, editor) {
      editor.update(transactions);
      document.document.dispatchTransactions(transactions);
    },
  });
  onTestFinished(() => view.destroy());
  const position = view.state.doc.toString().indexOf('call') + 4;
  view.dispatch({ changes: { from: position, insert: '(' }, selection: { anchor: position + 1 }, userEvent: 'input.type' });
  await flushPromises();
  expect(mocks.assist).toHaveBeenCalledWith(document.path.value, position + 1, 'signature', null, {}, 0);
  document.document.configureSurface(actions.extensions.value);
  view.setState(document.document.state.value);
  const result = document.document.state.value.facet(showTooltip).filter(Boolean);
  expect(result).toHaveLength(1);
  expect(result[0]?.pos).toBe(position + 1);
  mocks.assist.mockClear();
  startCompletion(view);
  await vi.waitFor(() => expect(mocks.assist).toHaveBeenCalled());
  expect(mocks.assist.mock.calls[0]![2]).toBe('complete');
});
it('records one failed startup with the original diagnostic and window scope', async () => {
  const { analysis } = await open();
  mocks.start.mockRejectedValueOnce(new Error('sample startup failure'));
  await analysis.start();
  expect(mocks.log).toHaveBeenCalledTimes(1);
  expect(mocks.log).toHaveBeenCalledWith(
    expect.objectContaining({
      level: 'error',
      code: 'java_analysis.window_failed',
      message: 'sample startup failure',
      fields: expect.objectContaining({ modRoot: 'M:/sample' }),
    }),
  );
  expect(analysis.status.value).toBe('Java 分析失败');
});
it('keeps files outside the registered roots out of analysis and coalesces startup requests', async () => {
  const mounted = mountSetup(() => {
    const host = useTextFiles({ sessionId: 'sample', modRoot: 'M:/sample' });
    return { host, analysis: useJavaEditor(host, 'M:/sample', ref(['M:/sample/src'])) };
  });
  const { host, analysis } = mounted.value;
  await host.ready;
  await host.openFiles([{ path: 'M:/sample/Outside.java' }]);
  expect(mocks.start).not.toHaveBeenCalled();
  expect(analysis.supports(host.active.value!)).toBe(false);
  await host.openFiles([{ path: 'M:/sample/src/Orbit.java' }]);
  await Promise.all([analysis.start(), analysis.start()]);
  expect(mocks.start).toHaveBeenCalledTimes(1);
  expect(mocks.sync.mock.calls[0]![0].map((file) => file.file)).toEqual(['M:/sample/src/Orbit.java']);
});
it('reuses same-revision background projections and refreshes all files after a semantic change', async () => {
  const { analysis, host, document } = await open();
  await host.openFiles(Array.from({ length: 49 }, (_, index) => ({ path: `M:/sample/src/File${index}.java` })));
  await analysis.start();
  expect(mocks.inspect).toHaveBeenCalledTimes(50);
  mocks.inspect.mockClear();
  const invalidation = { paths: [], tables: [], entities: [], resources: [], queryScopes: [], session: false };
  await projectChangeFixture('sample', invalidation, 'M:/sample');
  expect(mocks.inspect).toHaveBeenCalledTimes(1);
  document.setText('class Orbit { int field; }');
  mocks.inspect.mockClear();
  await projectChangeFixture('sample', invalidation, 'M:/sample');
  expect(mocks.inspect).toHaveBeenCalledTimes(50);
});
it('keeps signature extensions stable across view configuration transactions', async () => {
  const { actions, analysis, document } = await open();
  mocks.assist.mockResolvedValue({
    assistance: true,
    purpose: 'signature',
    project: 'sample',
    revision: 2,
    file: document.path.value,
    version: 2,
    argument: 0,
    files: [],
    choices: [],
    conflicts: [],
    candidates: [{ label: 'value', text: 'value()', detail: 'String ()', from: 0, to: 0, relevance: 1 }],
  });
  await analysis.start();
  await actions.parameters();
  const extensions = actions.extensions.value;
  document.document.configureSurface(extensions);
  expect(actions.extensions.value).toBe(extensions);
});
it('keeps the scheduled document projection after completion synchronizes a draft', async () => {
  const { analysis, document } = await open();
  await analysis.start();
  vi.useFakeTimers();
  mocks.inspect.mockClear();
  document.setText('class Orbit { int updated; }');
  await analysis.assist('complete', 6);
  expect(mocks.inspect).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(300);
  await analysis.settle();
  expect(mocks.inspect).toHaveBeenCalledExactlyOnceWith(document.path.value, 0, 'document');
  expect(analysis.current.value).toBeDefined();
});

it('captures the requested source position before waiting for draft submission', async () => {
  const { analysis, document } = await open();
  await analysis.start();
  document.setText('class Orbit { int value; }');
  document.document.locate(1, 7);
  let release!: () => void;
  mocks.sync.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  const requested = analysis.assist('rename', undefined, 'Renamed');
  await flushPromises();
  document.document.locate(1, 1);
  release();
  await requested;
  expect(mocks.assist).toHaveBeenLastCalledWith(document.path.value, 6, 'rename', 'Renamed', {}, 0);
});

it('hands off the latest startup draft, then combines edits into raw UTF-16 ranges before a query', async () => {
  const { analysis, document } = await open();
  let release!: () => void;
  mocks.start.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  const start = analysis.start();
  await flushPromises();
  document.setText('// 星🪐\r\nclass Orbit { int n=1; }');
  release();
  await start;
  expect(mocks.sync.mock.calls[0]![0][0]).toMatchObject({ version: 2, source: '// 星🪐\r\nclass Orbit { int n=1; }' });
  vi.useFakeTimers();
  const offset = document.document.state.value.doc.toString().indexOf('1');
  document.document.dispatch(
    document.document.state.value.update({
      changes: { from: offset, to: offset + 1, insert: '2' },
      annotations: Transaction.userEvent.of('input'),
    }),
  );
  document.document.dispatch(
    document.document.state.value.update({ changes: { from: offset + 1, insert: '3' }, annotations: Transaction.userEvent.of('input') }),
  );
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  await analysis.navigate('references');
  expect(mocks.sync.mock.calls[1]![0][0]).toMatchObject({
    source: null,
    version: 3,
    edits: [{ from: offset + 1, to: offset + 2, text: '23' }],
  });
  expect(mocks.inspect.mock.calls.at(-1)![2]).toBe('references');
  expect(mocks.sync.mock.invocationCallOrder[1]).toBeLessThan(mocks.inspect.mock.invocationCallOrder.at(-1)!);
});
it('waits for composition, preserves edits during IPC, and rejects an out-of-date result', async () => {
  const { analysis, document } = await open();
  await analysis.start();
  document.document.startComposition();
  const pending = analysis.navigate('references');
  await flushPromises();
  expect(mocks.inspect).toHaveBeenCalledTimes(1);
  document.setText('class Orbit { int value=2; }');
  document.document.finishComposition();
  await pending;
  const inFlight = analysis.navigate('references');
  let release!: (value: JavaInspection) => void;
  const stale: JavaInspection = {
    purpose: 'references',
    project: 'sample',
    file: document.path.value,
    revision: 3,
    version: 3,
    source: null,
    origin: null,
    binding: null,
    diagnostics: [],
    outline: [],
    locations: [{ file: 'M:/sample/Old.java', version: 1, range: { start: 0, end: 3 } }],
  };
  mocks.inspect.mockImplementationOnce(
    () =>
      new Promise((done) => {
        release = done;
      }),
  );
  await flushPromises();
  document.setText('class Orbit { int value=3; }');
  release(stale);
  await inFlight;
  expect(analysis.locations.value).toEqual([]);
  await analysis.navigate('references');
  expect(mocks.sync.mock.calls.at(-1)![0][0]!.source).toBeNull();
});
it('restores discarded text on close and preserves increasing versions when reopened', async () => {
  const { analysis, document, host } = await open();
  await analysis.start();
  document.setText('class Changed {}');
  await analysis.navigate('references');
  await host.close(document);
  await analysis.settle();
  expect(mocks.sync.mock.calls.at(-1)![0][0]).toMatchObject({ version: 4, source: '// 星🪐\r\nclass Orbit {}' });
  await host.openFiles([{ path: 'M:/sample/src/Orbit.java' }]);
  await analysis.navigate('references');
  expect(mocks.sync.mock.calls.at(-1)![0][0]!.version).toBe(5);
  const referenced = await host.openSnapshot('M:/reference/src/Library.java', 'class Library {}');
  expect(referenced).not.toBeNull();
  if (!referenced) throw Error('snapshot document required');
  referenced.setText('changed');
  referenced.undo();
  expect(referenced.document.state.value.doc.toString()).toBe('class Library {}');
  expect(await referenced.save()).toEqual({ status: 'noop' });
});
it('submits a newly opened file before inspecting it during an existing analysis request', async () => {
  const { analysis, host } = await open();
  let release!: (value: JavaInspection) => void;
  mocks.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const starting = analysis.start();
  await flushPromises();
  await host.openFiles([{ path: 'M:/sample/src/Second.java' }]);
  release({
    purpose: 'document',
    project: 'sample',
    revision: 2,
    file: 'M:/sample/src/Orbit.java',
    version: 2,
    source: null,
    origin: null,
    binding: null,
    diagnostics: [],
    outline: [],
    locations: [],
  });
  await starting;
  expect(mocks.inspect).toHaveBeenCalledTimes(1);
  await analysis.navigate('references');
  expect(mocks.sync.mock.calls.at(-1)![0][0]!.file).toBe('M:/sample/src/Second.java');
  expect(mocks.sync.mock.invocationCallOrder.at(-1)!).toBeLessThan(mocks.inspect.mock.invocationCallOrder.at(-1)!);
});

it('preserves the current location and delivers the original failed declaration load', async () => {
  const { host, analysis, document } = await open();
  document.document.locate(2, 7);
  const selection = document.document.state.value.selection;
  await expect(analysis.locate({ file: 'M:/sample/src/Absent.java', version: 1, range: { start: 0, end: 1 } })).rejects.toThrow(
    'sample file unavailable',
  );
  expect(host.active.value).toBe(document);
  expect(document.document.state.value.selection).toBe(selection);
});

it('releases a closed read-only reference projection and its diagnostics', async () => {
  const { host, analysis } = await open();
  await analysis.start();
  const inspect = mocks.inspect.getMockImplementation()!;
  mocks.inspect.mockImplementation(async (file, offset, purpose) => ({
    ...(await inspect(file, offset, purpose)),
    source: purpose === 'source' ? 'class Reference {}' : null,
    diagnostics: file.includes('/reference/')
      ? [{ file, version: 2, start: 6, end: 15, line: 1, message: 'reference warning', severity: 'warning' }]
      : [],
  }));
  await analysis.locate({ file: 'M:/reference/src/Reference.java', version: 2, range: { start: 6, end: 15 } });
  expect(analysis.diagnostics.value).toHaveLength(1);
  await host.close(host.active.value!);
  expect(host.documents).toHaveLength(1);
  expect(analysis.diagnostics.value).toEqual([]);
});

it.each(['rename', 'signature'] as const)('discards a queued %s after text changes', async (purpose) => {
  const { analysis, document } = await open();
  await analysis.start();
  let release!: () => void;
  mocks.inspect.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve({
            purpose: 'hover',
            project: 'sample',
            revision: 2,
            version: 2,
            file: document.path.value,
            source: null,
            origin: null,
            binding: null,
            diagnostics: [],
            outline: [],
            locations: [],
          });
      }),
  );
  const blocking = analysis.navigate('references');
  await flushPromises();
  const queued = analysis.assist(purpose);
  document.setText('class Different {}');
  release();
  await blocking;
  expect(await queued).toBeNull();
  expect(mocks.assist).not.toHaveBeenCalled();
});

it('ends a document input wait without analyzing its disposed state', async () => {
  const { host, analysis, document } = await open();
  await analysis.start();
  document.document.startComposition();
  document.setText('class Changed {}');
  const pending = analysis.navigate('references');
  await flushPromises();
  await host.close(document);
  await pending;
  await analysis.settle();
  expect(analysis.problem.value).toBe('');
  expect(mocks.log).not.toHaveBeenCalled();
  expect(host.documents).toEqual([]);
});

it('discards a parameter tooltip when the cursor moves during its query', async () => {
  const { analysis, actions, document } = await open();
  await analysis.start();
  document.document.locate(2, 7);
  let release!: (result: JavaAssistance) => void;
  mocks.assist.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = actions.parameters();
  await flushPromises();
  document.document.locate(2, 8);
  release({
    assistance: true,
    purpose: 'signature',
    project: 'sample',
    revision: 2,
    file: document.path.value,
    version: 2,
    argument: 0,
    files: [],
    choices: [],
    conflicts: [],
    candidates: [{ label: 'sample(int)', text: '', detail: 'int', from: 0, to: 0, relevance: 0 }],
  });
  await pending;
  document.document.configureSurface(actions.extensions.value);
  expect(document.document.state.value.facet(showTooltip).filter(Boolean)).toEqual([]);
});

it('discards completion from a project whose other source has pending edits', async () => {
  const { host, analysis, document } = await open();
  await host.openFiles([{ path: 'M:/sample/src/Other.java' }]);
  host.activate(document.path.value);
  await analysis.start();
  let release!: (result: JavaAssistance) => void;
  mocks.assist.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const pending = analysis.assist('complete', 6);
  await flushPromises();
  host.documents[1]!.setText('class Other {int changed;}');
  release({
    assistance: true,
    purpose: 'complete',
    project: 'sample',
    revision: 2,
    version: 2,
    file: document.path.value,
    argument: 0,
    candidates: [],
    files: [],
    choices: [],
    conflicts: [],
  });
  expect(await pending).toBeNull();
});
