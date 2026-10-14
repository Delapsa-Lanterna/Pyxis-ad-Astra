import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { effectScope } from 'vue';
import { flushPromises } from '@vue/test-utils';
import { useModFileBrowserViewModel } from './use-mod-file-browser-view-model';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useProjectStore } from '@/stores/project.store';
import { useModFileBrowserStore } from '@/stores/mod-file-browser.store';
import { sessionUpdateFixture, savedWriteFixture } from '@/test/write-result';
import { invalidateQueryCacheByProject } from '@/services/query-cache.service';
import type { ModDirectory, ModFileEntry } from '@/shared/types/mod-file-browser.types';
import type { CommittedWriteEvent } from '@/shared/types';
const mocks = vi.hoisted(() => ({
  directory: vi.fn(),
  search: vi.fn(),
  file: vi.fn(),
  open: vi.fn(),
  error: vi.fn(),
  listen: vi.fn(),
  handler: null as null | ((event: CommittedWriteEvent) => Promise<void>),
}));
vi.mock('@/services/mod-file-browser.service', () => ({
  queryModDirectory: mocks.directory,
  queryModFileSearch: mocks.search,
  queryModTextFileTarget: mocks.file,
}));
vi.mock('@/windows/file-editor.window', () => ({ openFileEditorWindow: mocks.open }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: mocks.error }) }));
vi.mock('@/orchestrators/project-session-refresh.orchestrator', () => ({ listenCommittedWrites: mocks.listen }));
const scopes: ReturnType<typeof effectScope>[] = [];
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
  if (update.status !== 'ready') throw new Error('ready fixture');
  useProjectStore().registerProjectManifest(update.projection.manifest);
  workspace.activateModFiles(root);
}
async function open() {
  const scope = effectScope();
  scopes.push(scope);
  const vm = scope.run(useModFileBrowserViewModel)!;
  await flushPromises();
  return { vm, scope };
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.resetAllMocks();
  mocks.listen.mockImplementation(async (handler) => {
    mocks.handler = handler;
    return vi.fn();
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
  scopes.splice(0).forEach((scope) => scope.stop());
  vi.useRealTimers();
});
describe('mod file browser actions and read lifetime', () => {
  it('reads only expanded directories and navigates nested folders with the keyboard', async () => {
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
  it('accepts only the latest directory response and ignores late errors after release', async () => {
    const { vm, scope } = await open();
    let older!: (value: ModDirectory) => void;
    let latest!: (value: ModDirectory) => void;
    mocks.directory
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
    const first = vm.actions.load(null),
      second = vm.actions.load(null);
    latest({ directory: null, entries: [entry('latest')] });
    await second;
    older({ directory: null, entries: [entry('older')] });
    await first;
    expect(vm.view.nodes.map((node) => node.key)).toEqual(['latest']);
    let reject!: (error: Error) => void;
    mocks.file.mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    const opening = vm.actions.activate('latest');
    scope.stop();
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
    await mocks.handler!({ modRoot: 'M:/A', sessionId: 's1', originWindowLabel: 'editor', reason: 'save', result });
    expect(mocks.directory).toHaveBeenCalledExactlyOnceWith('s1', 'data');
    mocks.directory.mockClear();
    invalidateQueryCacheByProject('s1', {
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
    const { scope } = await open();
    scope.stop();
    const stop = vi.fn();
    finish(stop);
    await flushPromises();
    expect(stop).toHaveBeenCalledOnce();
    useModFileBrowserStore().removeModState('M:/A');
    expect(useModFileBrowserStore().sessions.has('s1')).toBe(false);
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
    const { vm, scope } = await open();
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
    scope.stop();
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
    invalidateQueryCacheByProject('s1', {
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
    const { vm, scope } = await open();
    vi.useFakeTimers();
    vm.actions.setSearch('a');
    vm.actions.clearSearch();
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.search).not.toHaveBeenCalled();
    vm.actions.setSearch('b');
    scope.stop();
    await vi.advanceTimersByTimeAsync(300);
    expect(mocks.search).not.toHaveBeenCalled();
  });
});
