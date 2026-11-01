import { observeSavedContentFixture, committedChangeFixture } from '@/test/unit/project-changes';
import { projectChangeFixture } from '@/test/unit/project-changes';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { enableAutoUnmount, flushPromises } from '@vue/test-utils';
import { mountSetup } from '@/test/unit/mount-setup';
import { useModFileBrowserViewModel } from './use-mod-file-browser-view-model';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import { useModFileBrowserStore } from '@/stores/mod-file-browser.store';
import { sessionUpdateFixture, savedWriteFixture } from '@/test/fixtures/write-result';

import type { ModDirectory, ModFileEntry } from '@/shared/types/mod-file-browser.types';
import type { CommittedWriteEvent, SaveAcceptanceTask } from '@/shared/types';
const mocks = vi.hoisted(() => ({
  directory: vi.fn(),
  search: vi.fn(),
  file: vi.fn(),
  open: vi.fn(),
  error: vi.fn(),
  listen: vi.fn(),
  handler: null as null | ((event: CommittedWriteEvent) => SaveAcceptanceTask[] | undefined),
}));
vi.mock('@/services/mod-file-browser.service', () => ({
  queryModDirectory: mocks.directory,
  queryModFileSearch: mocks.search,
  queryModTextFileTarget: mocks.file,
}));
vi.mock('@/windows/file-editor.window', () => ({ openFileEditorWindow: mocks.open }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
vi.mock('@/orchestrators/project-sync.orchestrator', async () => ({
  ...(await import('@/test/unit/project-changes')),
  listenSavedContent: mocks.listen,
}));
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
async function paint() {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(performance.now()));
  await new Promise((resolve) => setTimeout(resolve, 0));
  await flushPromises();
}
enableAutoUnmount(afterEach);
const entry = (relPath: string, kind: ModFileEntry['kind'] = 'file'): ModFileEntry => ({
  name: relPath.split('/').at(-1)!,
  relPath,
  kind,
  sizeBytes: kind === 'file' ? 16 : null,
  modifiedAt: 1700000000000,
});
function register(id = 's1', root = 'M:/A') {
  const workspace = useWorkspaceStore();
  workspace.registerMod({ modRoot: root, displayName: root, version: '', status: 'ready' });
  const update = sessionUpdateFixture(id, root);
  useProjectStore().registerProjectManifest(update.projection.manifest);
  workspace.activateModFiles(root);
}
async function open() {
  const { value: vm, wrapper } = mountSetup(() => useModFileBrowserViewModel(() => useWorkspaceStore().activeManifest));
  await flushPromises();
  return { vm, wrapper };
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  frames.clear();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  mocks.listen.mockImplementation(async (handler) => {
    mocks.handler = handler;
    return observeSavedContentFixture(handler);
  });
  mocks.directory.mockImplementation(async (_id: string, path: string | null) => ({
    directory: path,
    entries:
      path === null
        ? [entry('data', 'directory'), entry('README'), entry('image.png'), entry('linked', 'restricted')]
        : path === 'data'
          ? [entry('data/nested', 'directory'), entry('data/spec.wpn')]
          : [entry('data/nested/file.txt')],
  }));
  mocks.open.mockResolvedValue({ status: 'accepted' });
  register();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('mod file browser actions and read lifetime', () => {
  it.each(['resolve', 'reject'] as const)(
    'revokes directory reads when its active manifest is removed before a late %s',
    async (completion) => {
      const { vm } = await open();
      let resolve!: (result: ModDirectory) => void;
      let reject!: (error: Error) => void;
      mocks.directory.mockImplementationOnce(
        () =>
          new Promise((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      );
      const pending = vm.actions.load(null);
      useProjectStore().removeProjectManifest('M:/A');
      if (completion === 'resolve') resolve({ directory: null, entries: [entry('obsolete')] });
      else reject(new Error('obsolete directory'));
      expect(await pending).toBe(false);
      await flushPromises();
      expect(vm.view.nodes).toEqual([]);
      expect(vm.view.title).toBe('');
      expect(vm.view.loading).toBe(false);
      expect(mocks.error).not.toHaveBeenCalled();
    },
  );
  it('loads expanded directories and navigates nested folders with the keyboard', async () => {
    const { vm } = await open();
    expect(mocks.directory).toHaveBeenCalledExactlyOnceWith('s1', null);
    vm.actions.navigate('ArrowDown');
    expect(vm.view.selected).toEqual(['data']);
    vm.actions.navigate('Enter');
    await flushPromises();
    expect(vm.view.expanded).toEqual(['data']);
    vm.actions.navigate('ArrowDown');
    expect(vm.view.selected).toEqual(['data/nested']);
    vm.actions.navigate('ArrowRight');
    await flushPromises();
    expect(mocks.directory).toHaveBeenLastCalledWith('s1', 'data/nested');
    vm.actions.navigate('ArrowLeft');
    expect(vm.view.expanded).toEqual(['data']);
    await vm.actions.activate('data');
    expect(vm.view.expanded).toEqual([]);
    await vm.actions.activate('data');
    await flushPromises();
    expect(mocks.directory.mock.calls.filter((call) => call[1] === 'data')).toHaveLength(2);
  });
  it('preserves per-Mod selection, expansion and scrolling while rereading on return', async () => {
    const { vm } = await open();
    await vm.actions.activate('data');
    await flushPromises();
    vm.actions.select(['data/spec.wpn']);
    vm.actions.setScroll(70);
    register('s2', 'M:/B');
    await flushPromises();
    expect(vm.view.selected).toEqual([]);
    expect(vm.view.expanded).toEqual([]);
    expect(vm.view.scrollTop).toBe(0);
    vm.actions.setScroll(20);
    useWorkspaceStore().activateModFiles('M:/A');
    await flushPromises();
    expect(vm.view.selected).toEqual(['data/spec.wpn']);
    expect(vm.view.expanded).toEqual(['data']);
    expect(vm.view.scrollTop).toBe(70);
    expect(mocks.directory).toHaveBeenLastCalledWith('s1', 'data');
  });
  it('opens the formally returned text target and leaves binary and restricted entries inactive', async () => {
    const { vm } = await open();
    mocks.file.mockResolvedValueOnce({ sessionId: 's1', modRoot: 'M:/A', path: 'M:/A/README' });
    await vm.actions.activate('README');
    expect(mocks.open).toHaveBeenCalledExactlyOnceWith({ sessionId: 's1', modRoot: 'M:/A', path: 'M:/A/README' });
    mocks.file.mockResolvedValueOnce(null);
    await vm.actions.activate('image.png');
    await vm.actions.activate('linked');
    expect(mocks.file).toHaveBeenCalledTimes(2);
    expect(mocks.open).toHaveBeenCalledOnce();
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it('routes undecodable text through the existing encoding feedback and keeps selection', async () => {
    const { vm } = await open();
    const error = { code: 'text.invalid_utf8', message: 'encoding error', location: { path: 'M:/A/README', line: null, column: null } };
    mocks.file.mockRejectedValueOnce(error);
    await vm.actions.activate('README');
    expect(vm.view.selected).toEqual(['README']);
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(error, '打开文件失败');
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('reports an already delivered window request failure after leaving the browser', async () => {
    const { vm, wrapper } = await open();
    mocks.file.mockResolvedValueOnce({ sessionId: 's1', modRoot: 'M:/A', path: 'M:/A/README' });
    let fail!: (error: Error) => void;
    mocks.open.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    await vm.actions.activate('README');
    wrapper.unmount();
    fail(new Error('window startup failed'));
    await flushPromises();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(expect.any(Error), '打开文件编辑器失败');
  });
  it('keeps accepted content through failure and recovers via refresh', async () => {
    const { vm } = await open();
    const before = vm.view.nodes;
    let fail!: (error: Error) => void;
    mocks.directory.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    const reading = vm.actions.refresh();
    expect(vm.view.ready).toBe(true);
    expect(vm.view.nodes).toBe(before);
    fail(new Error('目录读取失败'));
    await reading;
    expect(vm.view.error).toContain('目录读取失败');
    expect(vm.view.nodes).toBe(before);
    await vm.actions.refresh();
    expect(vm.view.error).toBe('');
  });
  it('removes stale selection and expansion and invalidates an older child read', async () => {
    const { vm } = await open();
    await vm.actions.activate('data');
    await flushPromises();
    vm.actions.select(['data/spec.wpn']);
    let complete!: (result: ModDirectory) => void;
    mocks.directory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const old = vm.actions.load('data');
    mocks.directory.mockResolvedValueOnce({ directory: null, entries: [entry('README')] });
    await vm.actions.refresh();
    complete({ directory: 'data', entries: [entry('data/old')] });
    await old;
    expect(vm.view.expanded).toEqual([]);
    expect(vm.view.selected).toEqual([]);
    expect(vm.view.nodes.map((node) => node.key)).toEqual(['README']);
    expect(useModFileBrowserStore().sessions.get('s1')!.directories.has('data')).toBe(false);
  });
  it('shares simultaneous directory reads and ignores late errors after release', async () => {
    const { vm, wrapper } = await open();
    let complete!: (value: ModDirectory) => void;
    mocks.directory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const count = mocks.directory.mock.calls.length;
    const first = vm.actions.load(null),
      second = vm.actions.load(null);
    expect(mocks.directory.mock.calls.length).toBe(count + 1);
    complete({ directory: null, entries: [entry('latest')] });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(vm.view.nodes.map((node) => node.key)).toEqual(['latest']);
    let reject!: (error: Error) => void;
    mocks.file.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const opening = vm.actions.activate('latest');
    wrapper.unmount();
    reject(new Error('late'));
    await opening;
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.open).not.toHaveBeenCalled();
  });
  it('refreshes related loaded directories from saved, renamed and replayed paths', async () => {
    const { vm } = await open();
    await vm.actions.activate('data');
    await flushPromises();
    mocks.directory.mockClear();
    const result = savedWriteFixture();
    result.changes = [
      {
        kind: 'file',
        beforePath: 'M:/A/data/old.wpn',
        afterPath: 'M:/A/data/new.wpn',
        beforeExists: true,
        afterExists: true,
        beforeText: '{}',
        afterText: '{}',
        beforeDataBase64: null,
        afterDataBase64: null,
        beforeFiles: [],
        afterFiles: [],
      },
    ];
    result.invalidation.paths = ['data/old.wpn', 'data/new.wpn'];
    const change = committedChangeFixture(result, 's1', 'M:/A');
    for (const task of mocks.handler!(change) ?? []) await task();
    await flushPromises();
    expect(mocks.directory).toHaveBeenCalledExactlyOnceWith('s1', 'data');
    mocks.directory.mockClear();
    void projectChangeFixture('s1', {
      paths: ['data/spec.wpn'],
      tables: [],
      entities: [],
      resources: [],
      queryScopes: [],
      session: false,
    });
    await flushPromises();
    expect(mocks.directory).toHaveBeenCalledExactlyOnceWith('s1', 'data');
  });
  it('releases late listener registration and module state during Mod removal', async () => {
    let finish!: (stop: () => void) => void;
    mocks.listen.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { wrapper } = await open();
    wrapper.unmount();
    const stop = vi.fn();
    finish(stop);
    await flushPromises();
    expect(stop).toHaveBeenCalledOnce();
    useModFileBrowserStore().removeModState('M:/A');
    expect(useModFileBrowserStore().sessions.has('s1')).toBe(false);
  });
});

describe('directory preload and display continuity', () => {
  it('prefetches one layer after display and reveals cached children before refreshing', async () => {
    const { vm } = await open();
    const rootNodes = vm.view.nodes;
    expect(mocks.directory).toHaveBeenCalledOnce();
    await paint();
    expect(mocks.directory.mock.calls.map((call) => call[1])).toEqual([null, 'data']);
    expect(vm.view.nodes).toBe(rootNodes);
    expect(vm.view.nodes[0]!.children).toEqual([]);
    await paint();
    expect(mocks.directory).toHaveBeenCalledTimes(2);

    let complete!: (value: ModDirectory) => void;
    mocks.directory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await vm.actions.activate('data');
    expect(vm.view.nodes[0]!.children!.map((node) => node.key)).toEqual(['data/nested', 'data/spec.wpn']);
    vm.actions.select(['data/spec.wpn']);
    vm.actions.setScroll(45);
    await paint();
    expect(mocks.directory).toHaveBeenLastCalledWith('s1', 'data/nested');
    expect(vm.view.directories.get('data').loading).toBe(true);
    complete({ directory: 'data', entries: [entry('data/nested', 'directory'), entry('data/spec.wpn')] });
    const before = vm.view.nodes;
    await flushPromises();
    expect(vm.view.nodes).toBe(before);
    expect(vm.view.selected).toEqual(['data/spec.wpn']);
    expect(vm.view.scrollTop).toBe(45);
  });
  it('joins a running preload on expansion and accepts its result once', async () => {
    const { vm } = await open();
    let complete!: (value: ModDirectory) => void;
    mocks.directory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await paint();
    await vm.actions.activate('data');
    expect(mocks.directory.mock.calls.filter((call) => call[1] === 'data')).toHaveLength(1);
    complete({ directory: 'data', entries: [entry('data/new.txt')] });
    await flushPromises();
    expect(vm.view.nodes[0]!.children![0]!.key).toBe('data/new.txt');
  });
  it('invalidates an in-flight listing on a committed change before reading its replacement', async () => {
    const { vm } = await open();
    let complete!: (value: ModDirectory) => void;
    mocks.directory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const old = vm.actions.load(null);
    mocks.directory.mockResolvedValueOnce({ directory: null, entries: [entry('current')] });
    void projectChangeFixture('s1', {
      paths: ['current'],
      tables: [],
      entities: [],
      resources: [],
      queryScopes: [],
      session: false,
    });
    await flushPromises();
    expect(await old).toBe(false);
    expect(vm.view.nodes.map((node) => node.key)).toEqual(['current']);
    complete({ directory: null, entries: [entry('obsolete')] });
    await flushPromises();
    expect(vm.view.nodes.map((node) => node.key)).toEqual(['current']);
  });
  it('ends queued frame work and late preloads on search, session replacement and release', async () => {
    const { vm, wrapper } = await open();
    mocks.search.mockResolvedValue(searchResult('find'));
    vm.actions.setSearch('find');
    await vm.actions.submitSearch();
    await paint();
    expect(mocks.directory).toHaveBeenCalledOnce();
    vm.actions.clearSearch();
    await flushPromises();
    let complete!: (value: ModDirectory) => void;
    mocks.directory.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await paint();
    register('s2', 'M:/B');
    await flushPromises();
    complete({ directory: 'data', entries: [entry('data/obsolete')] });
    await flushPromises();
    expect(useModFileBrowserStore().sessions.get('s1')!.directories.get('data')!.entries).toBe(null);
    wrapper.unmount();
    await paint();
    expect(frames.size).toBe(0);
    expect(vm.view.title).toBe('M:/B');
  });
});

function searchResult(query: string, entries: ModFileEntry[] = [entry('data', 'directory'), entry('data/find.txt')]) {
  return { query, entries, matchedPaths: entries.filter((entry) => entry.kind === 'file').map((entry) => entry.relPath) };
}
describe('full Mod search state and input boundary', () => {
  it('debounces input and lets Enter submit immediately without duplicating the pending timer', async () => {
    const { vm } = await open();
    vi.useFakeTimers();
    mocks.search.mockImplementation(async (_id: string, query: string) => searchResult(query));
    vm.actions.setSearch(' one ');
    await vi.advanceTimersByTimeAsync(249);
    expect(mocks.search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.search).toHaveBeenCalledExactlyOnceWith('s1', 'one');
    vm.actions.setSearch('two');
    await vm.actions.submitSearch();
    expect(mocks.search).toHaveBeenLastCalledWith('s1', 'two');
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.search).toHaveBeenCalledTimes(2);
  });
  it('automatically reveals matches while preserving ordinary expansion, selection and scrolling', async () => {
    const { vm } = await open();
    await vm.actions.activate('data');
    await flushPromises();
    vm.actions.select(['data/spec.wpn']);
    vm.actions.setScroll(75);
    mocks.search.mockResolvedValue(searchResult('find'));
    vm.actions.setSearch('find');
    await vm.actions.submitSearch();
    expect(vm.view.expanded).toEqual(['data']);
    expect(vm.view.nodes[0]!.children![0]!.key).toBe('data/find.txt');
    vm.actions.select(['data/find.txt']);
    vm.actions.setScroll(20);
    vm.actions.collapseAll();
    expect(vm.view.expanded).toEqual([]);
    await vm.actions.refresh();
    expect(vm.view.expanded).toEqual([]);
    expect(vm.view.selected).toEqual(['data/find.txt']);
    expect(vm.view.scrollTop).toBe(20);
    vm.actions.clearSearch();
    expect(vm.view.searching).toBe(false);
    expect(vm.view.expanded).toEqual(['data']);
    expect(vm.view.selected).toEqual(['data/spec.wpn']);
    expect(vm.view.scrollTop).toBe(75);
  });
  it('accepts only the latest search result and discards values and errors after release', async () => {
    const { vm, wrapper } = await open();
    let older!: (value: ReturnType<typeof searchResult>) => void;
    let latest!: (value: ReturnType<typeof searchResult>) => void;
    mocks.search
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            older = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            latest = resolve;
          }),
      );
    vm.actions.setSearch('old');
    const first = vm.actions.submitSearch();
    vm.actions.setSearch('latest');
    const second = vm.actions.submitSearch();
    latest(searchResult('latest', [entry('latest')]));
    await second;
    older(searchResult('old', [entry('old')]));
    await first;
    expect(vm.view.nodes[0]!.key).toBe('latest');
    let fail!: (error: Error) => void;
    mocks.search.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    vm.actions.setSearch('released');
    const pending = vm.actions.submitSearch();
    wrapper.unmount();
    fail(new Error('late'));
    await pending;
    expect(mocks.error).not.toHaveBeenCalled();
  });
  it('retains accepted search results on failure, retries and removes vanished search selection', async () => {
    const { vm } = await open();
    mocks.search.mockResolvedValueOnce(searchResult('find'));
    vm.actions.setSearch('find');
    await vm.actions.submitSearch();
    vm.actions.select(['data/find.txt']);
    mocks.search.mockRejectedValueOnce(new Error('搜索失败'));
    await vm.actions.refresh();
    expect(vm.view.error).toContain('搜索失败');
    expect(vm.view.selected).toEqual(['data/find.txt']);
    expect(vm.view.nodes[0]!.key).toBe('data');
    mocks.search.mockResolvedValueOnce(searchResult('find', []));
    await vm.actions.refresh();
    expect(vm.view.error).toBe('');
    expect(vm.view.nodes).toEqual([]);
    expect(vm.view.selected).toEqual([]);
  });
  it('keeps search and sorting scoped to each session and rereads the active query on return', async () => {
    const { vm } = await open();
    mocks.search.mockImplementation(async (_id: string, query: string) => searchResult(query));
    vm.actions.setSearch('find');
    await vm.actions.submitSearch();
    vm.actions.setSort('size');
    vm.actions.setSort('size');
    register('s2', 'M:/B');
    await flushPromises();
    expect(vm.view.searchText).toBe('');
    expect(vm.view.sort).toEqual({ key: 'name', ascending: true });
    useWorkspaceStore().activateModFiles('M:/A');
    await flushPromises();
    expect(vm.view.searchText).toBe('find');
    expect(vm.view.sort).toEqual({ key: 'size', ascending: false });
    expect(mocks.search).toHaveBeenLastCalledWith('s1', 'find');
  });
  it('refreshes an active full-tree query after committed changes', async () => {
    const { vm } = await open();
    mocks.search.mockResolvedValue(searchResult('find'));
    vm.actions.setSearch('find');
    await vm.actions.submitSearch();
    mocks.search.mockClear();
    void projectChangeFixture('s1', {
      paths: ['new/file.txt'],
      tables: [],
      entities: [],
      resources: [],
      queryScopes: [],
      session: false,
    });
    await flushPromises();
    expect(mocks.search).toHaveBeenCalledExactlyOnceWith('s1', 'find');
    expect(mocks.directory).toHaveBeenCalledOnce();
  });
  it('releases a queued debounce when clearing search or leaving its page', async () => {
    const { vm, wrapper } = await open();
    vi.useFakeTimers();
    vm.actions.setSearch('a');
    vm.actions.clearSearch();
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.search).not.toHaveBeenCalled();
    vm.actions.setSearch('b');
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.search).not.toHaveBeenCalled();
  });
});

it('reads the explicitly delivered target independently of workspace selection', async () => {
  register('other', 'M:/B');
  const { value: vm } = mountSetup(() => useModFileBrowserViewModel(() => ({ sessionId: 's1', modRoot: 'M:/A' })));
  await flushPromises();
  expect(useWorkspaceStore().activeManifest!.sessionId).toBe('other');
  expect(mocks.directory).toHaveBeenCalledWith('s1', null);
  expect(vm.view.title).toBe('M:/A');
});
