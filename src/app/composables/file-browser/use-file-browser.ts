import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { computed, nextTick, onScopeDispose, reactive, ref, watch } from 'vue';
import { useFileBrowserStore } from '@/stores/file-browser.store';
import { queryFileDirectory, queryFileSearch } from '@/services/file-browser.service';
import { createReadOwner } from '@/shared/runtime/read-request';
import { createFileTreeCache, fileSearchTree, visibleFiles, affectedFileDirectories } from '@/domain/file-browser/file-tree';
import { listenSavedContent, sessionContentUpdate } from '@/orchestrators/project-sync.orchestrator';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { formatError } from '@/shared/lib/errors';
import { relativePathFromRoot, normalizeFsPath, isAbsoluteFsPath } from '@/shared/lib/paths';
import { createFileDirectoryReads } from './use-directory-reads';
import { recordPerformance, startPerformance, performanceMonitorEnabled } from '@/shared/runtime/performance';
import type { FileDirectoryState, FileSortKey, ProjectManifest, FileEntry, AppFeedback } from '@/shared/types';

export type FileBrowserTarget = Readonly<Pick<ProjectManifest, 'sessionId' | 'modRoot'>>;
export function useFileBrowser(
  getTarget: () => FileBrowserTarget | null,
  openFile: (target: FileBrowserTarget, path: string, reads: ReturnType<typeof createReadOwner>) => Promise<unknown>,
  options: {
    state?: Pick<ReturnType<typeof useFileBrowserStore>, 'sessions' | 'establish' | 'directoryState' | 'acceptDirectory'>;
    directory?: string | null;
    prefetch?: boolean;
    include?: (entry: FileEntry) => boolean;
    feedback?: AppFeedback;
    contextMenu?: boolean;
  } = {},
) {
  const store = options.state ?? useFileBrowserStore(),
    feedback = options.feedback ?? useAppFeedback(),
    reads = createReadOwner(),
    tree = createFileTreeCache();
  const target = computed(getTarget);
  const base = options.directory ?? null;
  const state = computed(() => (target.value ? store.sessions.get(target.value.sessionId)! : null));
  const searching = computed(() => Boolean(state.value?.search.text.trim()));
  const branch = computed(() => (searching.value ? state.value!.search : state.value));
  const nodes = computed(() => {
    const current = state.value;
    if (!current) return [];
    return searching.value
      ? current.search.result
        ? fileSearchTree(current.search.result, current.sort)
        : []
      : tree.project(
          base === null ? current.directories : new Map(current.directories).set(null, current.directories.get(base)!),
          current.expanded,
          current.sort,
        );
  });
  const root = computed(() => state.value?.directories.get(base)),
    refreshing = ref(false);
  let disposed = false,
    stopWrites: (() => void) | null = null,
    refreshVersion = 0,
    searchTimer: ReturnType<typeof setTimeout> | null = null;
  function cancelSearchTimer() {
    if (searchTimer !== null) {
      clearTimeout(searchTimer);
      searchTimer = null;
    }
  }
  const directoryReads = createFileDirectoryReads({
    load: ({ sessionId, directory }) => queryFileDirectory(sessionId, directory),
    started: ({ sessionId, directory }) => {
      const status = store.directoryState(sessionId, directory);
      status.loading = true;
      status.error = '';
    },
    ready: ({ sessionId }, result) => {
      if (options.include) result = { ...result, entries: result.entries.filter(options.include) };
      const removed = store.acceptDirectory(sessionId, result);
      if (removed.length) {
        tree.forget(removed);
        directoryReads.revoke(
          ({ directory }) => directory !== null && removed.some((path) => directory === path || directory.startsWith(path + '/')),
        );
      }
    },
    error: ({ sessionId, directory }, error) => {
      store.directoryState(sessionId, directory).error = formatError(error);
    },
    settled: ({ sessionId, directory }) => {
      const status = store.sessions.get(sessionId)?.directories.get(directory);
      if (status) status.loading = false;
    },
  });
  const displayed = new Map<string | null, { startedAt: number; cached: boolean } | undefined>();
  let prefetchFrame: number | null = null,
    prefetchTimer: ReturnType<typeof setTimeout> | null = null;
  function cancelPrefetch() {
    displayed.clear();
    if (prefetchFrame !== null) cancelAnimationFrame(prefetchFrame);
    prefetchFrame = null;
    if (prefetchTimer !== null) clearTimeout(prefetchTimer);
    prefetchTimer = null;
  }
  function isDisplayed(directory: string | null) {
    return directory === base || (directory !== null && state.value!.expanded.includes(directory) && ancestorsExpanded(directory));
  }
  function afterDisplay(directory: string | null, sample?: { startedAt: number; cached: boolean }) {
    if (disposed || searching.value || !isDisplayed(directory)) return;
    if (!displayed.has(directory) || sample) displayed.set(directory, sample);
    void nextTick(() => {
      if (disposed || !displayed.size || prefetchFrame !== null || prefetchTimer !== null) return;
      prefetchFrame = requestAnimationFrame(() => {
        prefetchFrame = null;
        const pending = [...displayed];
        displayed.clear();
        const sessionId = target.value!.sessionId;
        for (const [directory, sample] of pending) {
          if (!isDisplayed(directory)) continue;
          if (performanceMonitorEnabled && sample)
            recordPerformance('fileBrowser.directoryFrame', performance.now() - sample.startedAt, {
              cached: sample.cached,
            });
        }
        if (options.prefetch === false) return;
        prefetchTimer = setTimeout(() => {
          prefetchTimer = null;
          for (const [directory] of pending) {
            if (!isDisplayed(directory)) continue;
            for (const entry of state.value!.directories.get(directory)?.entries ?? [])
              if (entry.kind === 'directory' && !state.value!.directories.get(entry.relPath)?.entries)
                void directoryReads.request({ sessionId, directory: entry.relPath }, 'prefetch');
          }
          for (const directory of displayed.keys()) afterDisplay(directory);
        }, 0);
      });
    });
  }
  async function load(directory: string | null = base, required = false) {
    const captured = target.value;
    if (!captured || disposed) return false;
    const accepted = await directoryReads.request({ sessionId: captured.sessionId, directory }, 'foreground', required);
    if (accepted && captured.sessionId === target.value?.sessionId) afterDisplay(directory);
    return accepted;
  }
  async function submitSearch(required = false) {
    cancelSearchTimer();
    const captured = target.value,
      query = state.value?.search.text.trim();
    if (!captured || !query || disposed) return;
    const search = state.value!.search;
    search.loading = true;
    search.error = '';
    await reads.consume('search', { sessionId: captured.sessionId, query }, () => queryFileSearch(captured.sessionId, query, base), {
      ready: (result) => {
        if (options.include) result = { ...result, entries: result.entries.filter(options.include) };
        const same = search.result?.query === result.query;
        const directories = result.entries.filter((entry) => entry.kind === 'directory').map((entry) => entry.relPath);
        search.expanded = same ? search.expanded.filter((path) => directories.includes(path)) : directories;
        search.selected = same && result.entries.some((entry) => entry.relPath === search.selected) ? search.selected : null;
        if (!same) search.scrollTop = 0;
        search.result = result;
      },
      error: (error) => {
        search.error = formatError(error);
        if (required) throw error;
      },
      settled: () => {
        search.loading = false;
      },
    });
  }
  function setSearch(text: string) {
    cancelSearchTimer();
    reads.revoke('consumer', 'search');
    reads.revoke('consumer', 'open');
    cancelPrefetch();
    directoryReads.revoke();
    refreshVersion++;
    refreshing.value = false;
    const search = state.value!.search;
    search.text = text;
    search.error = '';
    search.loading = Boolean(text.trim());
    if (!text.trim()) {
      search.result = null;
      search.expanded = [];
      search.selected = null;
      search.scrollTop = 0;
      afterDisplay(base);
      for (const path of state.value!.expanded) afterDisplay(path);
      return;
    }
    searchTimer = setTimeout(() => void submitSearch(), 250);
  }
  async function refresh() {
    if (searching.value) {
      await submitSearch();
      return;
    }
    const version = ++refreshVersion,
      captured = target.value;
    if (!captured || disposed) return;
    refreshing.value = true;
    try {
      if (!(await load(base))) return;
      for (const directory of [...state.value!.expanded].sort((a, b) => a.split('/').length - b.split('/').length)) {
        if (disposed || searching.value || version !== refreshVersion || target.value?.sessionId !== captured.sessionId) return;
        if (state.value!.expanded.includes(directory) && ancestorsExpanded(directory)) await load(directory);
      }
    } finally {
      if (version === refreshVersion) refreshing.value = false;
    }
  }
  function ancestorsExpanded(path: string) {
    const parts = path.split('/');
    return parts
      .slice(0, -1)
      .every(
        (_part, index) =>
          parts.slice(0, index + 1).join('/') === base || state.value!.expanded.includes(parts.slice(0, index + 1).join('/')),
      );
  }
  function setExpanded(keys: Array<string | number>) {
    const current = branch.value!,
      added = keys.filter((key): key is string => typeof key === 'string' && !current.expanded.includes(key));
    current.expanded = keys.map(String);
    if (searching.value) return;
    for (const path of added) {
      const sample = {
        startedAt: startPerformance(),
        cached: Boolean(state.value!.directories.get(path)?.entries),
      };
      if (sample.cached) afterDisplay(path, sample);
      if (sample.cached && options.prefetch === false) continue;
      void reloadBranch(path, sample.cached ? undefined : sample);
    }
  }
  async function reloadBranch(path: string, sample?: { startedAt: number; cached: boolean }) {
    const captured = target.value!.sessionId;
    if (!(await load(path))) return;
    if (disposed || searching.value || target.value?.sessionId !== captured) return;
    if (sample) afterDisplay(path, sample);
    for (const child of state
      .value!.expanded.filter((directory) => directory.startsWith(path + '/'))
      .sort((a, b) => a.split('/').length - b.split('/').length)) {
      if (disposed || searching.value || target.value?.sessionId !== captured || !state.value!.expanded.includes(path)) return;
      if (state.value!.expanded.includes(child) && ancestorsExpanded(child)) await load(child);
    }
  }
  function select(keys: Array<string | number>) {
    branch.value!.selected = keys.length ? String(keys[0]) : null;
  }
  async function activate(path: string) {
    const current = branch.value!,
      node = visibleFiles(nodes.value, current.expanded).find((node) => node.key === path);
    if (!node || node.disabled) return;
    current.selected = path;
    if (node.kind === 'directory') {
      setExpanded(current.expanded.includes(path) ? current.expanded.filter((key) => key !== path) : [...current.expanded, path]);
      return;
    }
    const captured = target.value!;
    await openFile(captured, path, reads);
  }
  function navigate(key: string) {
    const current = branch.value!,
      items = visibleFiles(nodes.value, current.expanded).filter((node) => !node.disabled);
    if (!items.length) return;
    const index = items.findIndex((node) => node.key === current.selected),
      node = items[index];
    if (key === 'ArrowDown' || key === 'ArrowUp')
      current.selected = items[Math.max(0, Math.min(items.length - 1, index + (key === 'ArrowDown' ? 1 : -1)))]!.key;
    else if (key === 'ArrowRight' && node?.kind === 'directory') {
      if (!current.expanded.includes(node.key)) setExpanded([...current.expanded, node.key]);
      else if (items[index + 1]?.key.startsWith(node.key + '/')) current.selected = items[index + 1]!.key;
    } else if (key === 'ArrowLeft' && node) {
      if (current.expanded.includes(node.key)) setExpanded(current.expanded.filter((path) => path !== node.key));
      else if (node.key.includes('/')) current.selected = node.key.slice(0, node.key.lastIndexOf('/'));
    } else if (key === 'Enter' && node) void activate(node.key);
  }
  function resetPending(sessionId: string | undefined) {
    if (!sessionId) return;
    const previous = store.sessions.get(sessionId);
    if (previous) {
      previous.search.loading = false;
      for (const status of previous.directories.values()) status.loading = false;
    }
  }
  let ready = Promise.resolve();
  watch(
    () => target.value?.sessionId,
    async (_session, previous) => {
      cancelSearchTimer();
      refreshVersion++;
      reads.revoke();
      cancelPrefetch();
      directoryReads.revoke();
      tree.clear();
      refreshing.value = false;
      resetPending(previous);
      if (target.value) store.establish(target.value.sessionId, target.value.modRoot);
      await (ready = refresh());
    },
    { immediate: true, flush: 'sync' },
  );
  function scheduleUpdates(paths: readonly string[], whole: boolean) {
    if (searching.value) {
      return whole || paths.length ? [() => submitSearch(true)] : [];
    }
    const affected = whole ? [...state.value!.directories.keys()] : affectedFileDirectories(state.value!.directories, paths);
    directoryReads.revoke(({ directory }) => affected.includes(directory));
    return affected.map((directory) => () => load(directory, true).then(() => {}));
  }
  void listenSavedContent(
    (change) => {
      const captured = target.value;
      const update = sessionContentUpdate(change, captured?.sessionId);
      if (!update) return;
      if (!captured || disposed || update.manifest.sessionId !== captured.sessionId) return;

      if (normalizeFsPath(update.manifest.modRoot) !== normalizeFsPath(captured.modRoot)) return;
      const paths = update.invalidation.paths.map((path) => (isAbsoluteFsPath(path) ? relativePathFromRoot(captured.modRoot, path) : path));
      return scheduleUpdates(paths, update.invalidation.session);
    },
    (sessionId) => {
      if (sessionId !== target.value?.sessionId) return;
      cancelSearchTimer();
      reads.revoke('session');
      cancelPrefetch();
      directoryReads.revoke(() => true, 'session');
      resetPending(sessionId);
    },
  )
    .then((stop) => {
      if (disposed) stop();
      else stopWrites = stop;
    })
    .catch((error) => {
      if (!disposed) feedback.error(error, '监听文件变化失败');
    });
  onScopeDispose(() => {
    disposed = true;
    cancelSearchTimer();
    refreshVersion++;
    reads.revoke();
    cancelPrefetch();
    directoryReads.revoke();
    tree.clear();
    stopWrites?.();
    resetPending(target.value?.sessionId);
  });
  if (options.contextMenu !== false)
    useContextMenuScope({ identity: () => JSON.stringify(target.value), refresh, canRefresh: () => Boolean(target.value) });
  return {
    get ready() {
      return ready;
    },
    view: reactive({
      nodes,
      searching,
      searchText: computed(() => state.value?.search.text ?? ''),
      sort: computed(() => state.value?.sort ?? { key: 'name' as const, ascending: true }),
      refreshing: computed(() => refreshing.value || Boolean(searching.value && state.value?.search.loading)),
      expanded: computed(() => branch.value?.expanded ?? []),
      selected: computed(() => (branch.value?.selected ? [branch.value.selected] : [])),
      scrollTop: computed(() => branch.value?.scrollTop ?? 0),
      title: computed(() => target.value?.modRoot ?? ''),
      loading: computed(() => (searching.value ? Boolean(state.value?.search.loading) : Boolean(root.value?.loading))),
      ready: computed(() =>
        searching.value ? state.value?.search.result !== null : root.value?.entries !== null && root.value?.entries !== undefined,
      ),
      error: computed(() => (searching.value ? (state.value?.search.error ?? '') : (root.value?.error ?? ''))),
      directories: computed(() => state.value?.directories ?? new Map<string | null, FileDirectoryState>()),
    }),
    actions: {
      load,
      refresh,
      setExpanded,
      select,
      activate,
      navigate,
      setSearch,
      submitSearch,
      clearSearch: () => setSearch(''),
      collapseAll: () => setExpanded([]),
      setSort: (key: FileSortKey) => {
        const sort = state.value!.sort;
        state.value!.sort = { key, ascending: sort.key === key ? !sort.ascending : true };
      },
      setScroll: (top: number) => {
        if (branch.value) branch.value.scrollTop = top;
      },
    },
  };
}
