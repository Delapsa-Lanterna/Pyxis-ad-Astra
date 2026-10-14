import { computed, onScopeDispose, reactive, ref, watch } from 'vue';
import { useProjectStore } from '@/stores/project.store';
import { useModFileBrowserStore } from '@/stores/mod-file-browser.store';
import { queryModDirectory, queryModFileSearch, queryModTextFileTarget } from '@/services/mod-file-browser.service';
import { createReadTicketOwner } from '@/shared/runtime/read-request';
import { modFileTree, modFileSearchTree, visibleModFiles, affectedModDirectories } from '@/domain/mod-file-browser/file-tree';
import { subscribeQueryInvalidations } from '@/services/query-cache.service';
import { listenCommittedWrites } from '@/orchestrators/project-session-refresh.orchestrator';
import { openFileEditorWindow } from '@/windows/file-editor.window';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { formatError } from '@/shared/lib/errors';
import { relativePathFromRoot, pathBelongsToRoot, normalizeFsPath } from '@/shared/lib/paths';
import type { ModFileSortKey } from '@/shared/types';
export function useModFileBrowserViewModel() {
  const project = useProjectStore(),
    store = useModFileBrowserStore(),
    feedback = useAppFeedback(),
    reads = createReadTicketOwner();
  const target = computed(() => project.activeManifest);
  const state = computed(() => (target.value ? store.sessions.get(target.value.sessionId)! : null));
  const searching = computed(() => Boolean(state.value?.search.text.trim()));
  const branch = computed(() => (searching.value ? state.value!.search : state.value));
  const nodes = computed(() => {
    const current = state.value;
    if (!current) return [];
    return searching.value
      ? current.search.result
        ? modFileSearchTree(current.search.result, current.sort)
        : []
      : modFileTree(current.directories, null, current.sort);
  });
  const root = computed(() => state.value?.directories.get(null)),
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
  async function load(directory: string | null) {
    const captured = target.value;
    if (!captured || disposed) return false;
    const status = store.directoryState(captured.sessionId, directory);
    status.loading = true;
    status.error = '';
    return reads.consume(
      'directory:' + JSON.stringify(directory),
      { sessionId: captured.sessionId, directory },
      () => queryModDirectory(captured.sessionId, directory),
      {
        ready: (result) => {
          const loading = [...store.sessions.get(captured.sessionId)!.directories]
            .filter(([, status]) => status.loading)
            .map(([directory]) => directory);
          const removed = store.acceptDirectory(captured.sessionId, result);
          for (const directory of loading)
            if (directory !== null && removed.some((path) => directory === path || directory.startsWith(path + '/')))
              reads.revoke('consumer', 'directory:' + JSON.stringify(directory));
        },
        error: (error) => {
          status.error = formatError(error);
        },
        settled: () => {
          status.loading = false;
        },
      },
    );
  }
  async function submitSearch() {
    cancelSearchTimer();
    const captured = target.value,
      query = state.value?.search.text.trim();
    if (!captured || !query || disposed) return;
    const search = state.value!.search;
    search.loading = true;
    search.error = '';
    await reads.consume('search', { sessionId: captured.sessionId, query }, () => queryModFileSearch(captured.sessionId, query), {
      ready: (result) => {
        const same = search.result?.query === result.query;
        const directories = result.entries.filter((entry) => entry.kind === 'directory').map((entry) => entry.relPath);
        search.expanded = same ? search.expanded.filter((path) => directories.includes(path)) : directories;
        search.selected = same && result.entries.some((entry) => entry.relPath === search.selected) ? search.selected : null;
        if (!same) search.scrollTop = 0;
        search.result = result;
      },
      error: (error) => {
        search.error = formatError(error);
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
    const search = state.value!.search;
    search.text = text;
    search.error = '';
    search.loading = Boolean(text.trim());
    if (!text.trim()) {
      search.result = null;
      search.expanded = [];
      search.selected = null;
      search.scrollTop = 0;
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
      if (!(await load(null))) return;
      for (const directory of [...state.value!.expanded].sort((a, b) => a.split('/').length - b.split('/').length)) {
        if (disposed || version !== refreshVersion || target.value?.sessionId !== captured.sessionId) return;
        if (state.value!.expanded.includes(directory) && ancestorsExpanded(directory)) await load(directory);
      }
    } finally {
      if (version === refreshVersion) refreshing.value = false;
    }
  }
  function ancestorsExpanded(path: string) {
    const parts = path.split('/');
    return parts.slice(0, -1).every((_part, index) => state.value!.expanded.includes(parts.slice(0, index + 1).join('/')));
  }
  function setExpanded(keys: Array<string | number>) {
    const current = branch.value!,
      added = keys.filter((key): key is string => typeof key === 'string' && !current.expanded.includes(key));
    current.expanded = keys.map(String);
    if (searching.value) return;
    for (const path of added) void reloadBranch(path);
    for (const [path, status] of state.value!.directories)
      if (path !== null && (!current.expanded.includes(path) || !ancestorsExpanded(path)) && status.loading) {
        reads.revoke('consumer', 'directory:' + JSON.stringify(path));
        status.loading = false;
      }
  }
  async function reloadBranch(path: string) {
    const captured = target.value!.sessionId;
    if (!(await load(path))) return;
    for (const child of state
      .value!.expanded.filter((directory) => directory.startsWith(path + '/'))
      .sort((a, b) => a.split('/').length - b.split('/').length)) {
      if (disposed || target.value?.sessionId !== captured || !state.value!.expanded.includes(path)) return;
      if (state.value!.expanded.includes(child) && ancestorsExpanded(child)) await load(child);
    }
  }
  function select(keys: Array<string | number>) {
    branch.value!.selected = keys.length ? String(keys[0]) : null;
  }
  async function activate(path: string) {
    const current = branch.value!,
      node = visibleModFiles(nodes.value, current.expanded).find((node) => node.key === path);
    if (!node || node.disabled) return;
    current.selected = path;
    if (node.kind === 'directory') {
      setExpanded(current.expanded.includes(path) ? current.expanded.filter((key) => key !== path) : [...current.expanded, path]);
      return;
    }
    const captured = target.value!;
    await reads.consume('open', { sessionId: captured.sessionId, path }, () => queryModTextFileTarget(captured.sessionId, path), {
      ready: (result) => {
        if (result)
          void openFileEditorWindow({ ...result }).catch((error) => {
            if (!disposed && target.value?.sessionId === captured.sessionId) feedback.error(error, '打开文件编辑器失败');
          });
      },
      error: (error) => feedback.error(error, '打开文件失败'),
    });
  }
  function navigate(key: string) {
    const current = branch.value!,
      items = visibleModFiles(nodes.value, current.expanded).filter((node) => !node.disabled);
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
  watch(
    () => target.value?.sessionId,
    async (_session, previous) => {
      cancelSearchTimer();
      refreshVersion++;
      reads.revoke();
      refreshing.value = false;
      resetPending(previous);
      if (target.value) store.establish(target.value.sessionId, target.value.modRoot);
      await refresh();
    },
    { immediate: true, flush: 'sync' },
  );
  function scheduleUpdates(paths: readonly string[]) {
    if (searching.value) {
      if (paths.length) reads.schedule('search-update', () => void submitSearch());
      return;
    }
    for (const directory of affectedModDirectories(state.value!.directories, paths))
      reads.schedule('refresh:' + JSON.stringify(directory), () => void load(directory));
  }
  const stopInvalidation = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== target.value?.sessionId) return;
    if (event.scope === 'session') {
      cancelSearchTimer();
      reads.revoke('session');
      resetPending(event.sessionId);
      return;
    }
    scheduleUpdates(event.invalidation?.paths ?? []);
  });
  void listenCommittedWrites(async (event) => {
    const captured = target.value;
    if (!captured || disposed || normalizeFsPath(event.modRoot) !== normalizeFsPath(captured.modRoot)) return;
    if (event.sessionId && event.sessionId !== captured.sessionId) return;
    const paths = event.result.changes
      .flatMap((change) => [change.beforePath, change.afterPath])
      .filter((path) => pathBelongsToRoot(path, captured.modRoot))
      .map((path) => relativePathFromRoot(captured.modRoot, path));
    if (searching.value) {
      if (paths.length) await submitSearch();
      return;
    }
    for (const directory of affectedModDirectories(state.value!.directories, paths)) {
      if (disposed || target.value?.sessionId !== captured.sessionId) return;
      if (state.value!.directories.has(directory)) await load(directory);
    }
  })
    .then((stop) => {
      if (disposed) stop();
      else stopWrites = stop;
    })
    .catch((error) => {
      if (!disposed) feedback.error(error, '监听 Mod 文件变化失败');
    });
  onScopeDispose(() => {
    disposed = true;
    cancelSearchTimer();
    refreshVersion++;
    reads.revoke();
    stopWrites?.();
    stopInvalidation();
    resetPending(target.value?.sessionId);
  });
  return {
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
      directories: computed(() => state.value?.directories ?? new Map()),
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
      setSort: (key: ModFileSortKey) => {
        const sort = state.value!.sort;
        state.value!.sort = { key, ascending: sort.key === key ? !sort.ascending : true };
      },
      setScroll: (top: number) => {
        if (branch.value) branch.value.scrollTop = top;
      },
    },
  };
}
