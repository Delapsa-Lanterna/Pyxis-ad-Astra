import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { Transaction } from '@codemirror/state';
import { ref } from 'vue';
import { mountSetup } from '@/test/unit/mount-setup';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { initializeSettingsStore } from '@/stores/settings.store';
import { useCodeEditor } from './use-code-editor';
import { useCodeAnalysis } from './use-code-analysis';
import { useCodeActions } from './use-code-actions';
import type { startJavaEditor, syncJavaEditor, inspectJavaEditor, assistJavaEditor } from '@/services/java-analysis.service';
import type { JavaInspection } from '@/shared/types';
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
vi.mock('@/services/text-editor.service', () => ({
  loadTextFile: async (_session: string, _root: string, path: string) => ({
    path,
    text: '// 星🪐\r\nclass Orbit {}',
    entity: null,
    baseVersions: [],
  }),
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
    const host = useCodeEditor({ sessionId: 'sample', modRoot: 'M:/sample' });
    const analysis = useCodeAnalysis(host, 'M:/sample');
    return { host, analysis, actions: useCodeActions(host, analysis, { sessionId: 'sample', modRoot: 'M:/sample' }) };
  });
  await mounted.value.host.ready;
  await mounted.value.host.openFiles([{ path: 'M:/sample/src/Orbit.java' }]);
  return { ...mounted, ...mounted.value, document: mounted.value.host.active.value! };
}
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
    const host = useCodeEditor({ sessionId: 'sample', modRoot: 'M:/sample' });
    return { host, analysis: useCodeAnalysis(host, 'M:/sample', ref(['M:/sample/src'])) };
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
  await pending;
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
