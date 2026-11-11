import { computed, onScopeDispose, shallowReactive, shallowRef } from 'vue';
import { createFileDirectoryReads } from '@/app/composables/file-browser/use-directory-reads';
import { createFileTreeCache, fileSearchTree, affectedFileDirectories } from '@/domain/file-browser/file-tree';
import { queryFileDirectory, queryFileSearch, queryFileTextTarget } from '@/services/file-browser.service';
import { queryCodeEditorSources } from '@/services/code-editor.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { listenSavedContent } from '@/orchestrators/project-sync.orchestrator';
import { errorDiagnosticOf } from '@/shared/lib/errors';
import { pathBelongsToRoot, relativePathFromRoot, isAbsoluteFsPath } from '@/shared/lib/paths';
import type { CodeEditorSource, CodeEditorSources, FileDirectoryState, FileSearch } from '@/shared/types';
import type { useCodeEditor } from './use-code-editor';

function branch(source: CodeEditorSource) {
  return shallowReactive({
    source,
    directories: shallowReactive(new Map<string | null, FileDirectoryState>()),
    expanded: [] as string[],
    selected: [] as string[],
    searchExpanded: [] as string[],
    searchSelected: [] as string[],
    opened: !source.readOnly,
    search: null as FileSearch | null,
    loading: false,
    error: '',
    tree: createFileTreeCache(),
  });
}
export type CodeProjectBranch = ReturnType<typeof branch>;
const sort = { key: 'name' as const, ascending: true };
export function useCodeProject(host: ReturnType<typeof useCodeEditor>, reference: (path: string) => Promise<void>) {
  const feedback = useAppFeedback(),
    reads = useQueryReadOwner(),
    searches = useQueryReadOwner();
  const sources = shallowRef<CodeEditorSources | null>(null),
    branches = shallowReactive<CodeProjectBranch[]>([]);
  const searchText = shallowRef(''),
    problem = shallowRef('');
  let disposed = false,
    stop: (() => void) | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  let opening = Promise.resolve();
  const find = (id: string) => branches.find((entry) => entry.source.sessionId === id);
  function status(entry: CodeProjectBranch, directory: string | null) {
    let value = entry.directories.get(directory);
    if (!value) {
      value = shallowReactive({ entries: null, loading: false, error: '' });
      entry.directories.set(directory, value);
    }
    return value;
  }
  const directories = createFileDirectoryReads({
    load: (identity) => queryFileDirectory(identity.sessionId, identity.directory),
    started: ({ sessionId, directory }) => {
      const entry = find(sessionId)!;
      status(entry, directory).loading = true;
      status(entry, directory).error = '';
    },
    ready: ({ sessionId, directory }, result) => {
      const entry = find(sessionId)!;
      const previous = status(entry, directory).entries ?? [];
      const removed = previous
        .filter((file) => file.kind === 'directory' && !result.entries.some((next) => next.relPath === file.relPath))
        .map((file) => file.relPath);
      for (const key of [...entry.directories.keys()])
        if (key && removed.some((path) => key === path || key.startsWith(path + '/'))) entry.directories.delete(key);
      if (removed.length) {
        entry.tree.forget(removed);
        entry.expanded = entry.expanded.filter((key) => !removed.some((path) => key === path || key.startsWith(path + '/')));
        directories.revoke(
          (identity) =>
            identity.sessionId === sessionId &&
            removed.some((path) => identity.directory === path || identity.directory?.startsWith(path + '/')),
        );
      }
      status(entry, directory).entries = result.entries.filter(
        (file) => !entry.source.readOnly || file.kind !== 'file' || /\.java$/i.test(file.name),
      );
    },
    error: ({ sessionId, directory }, error) => {
      status(find(sessionId)!, directory).error = errorDiagnosticOf(error).message;
    },
    settled: ({ sessionId, directory }) => {
      const entry = find(sessionId);
      if (entry) status(entry, directory).loading = false;
    },
  });
  function load(entry: CodeProjectBranch, directory = entry.source.directory, refresh = false) {
    if (!refresh && status(entry, directory).entries !== null) return Promise.resolve(true);
    return directories.request({ sessionId: entry.source.sessionId, directory });
  }
  function nodes(entry: CodeProjectBranch) {
    if (searchText.value.trim()) return entry.search ? fileSearchTree(entry.search, sort) : [];
    const base = entry.source.directory;
    const data = base === null ? entry.directories : new Map(entry.directories).set(null, status(entry, base));
    return entry.tree.project(data, entry.expanded, sort);
  }
  async function search() {
    clearTimeout(timer);
    const query = searchText.value.trim();
    for (const entry of branches.filter((item) => item.opened)) {
      if (!query) {
        searches.revoke();
        entry.search = null;
        entry.loading = false;
        continue;
      }
      entry.loading = true;
      entry.error = '';
      await searches.consume(entry.source.sessionId, { query }, () => queryFileSearch(entry.source.sessionId, query), {
        ready: (result) => {
          const base = entry.source.directory;
          const entries = result.entries.filter(
            (file) =>
              (!base || file.relPath === base || file.relPath.startsWith(base + '/')) &&
              (!entry.source.readOnly || file.kind !== 'file' || /\.java$/i.test(file.name)),
          );
          entry.search = { ...result, entries };
          entry.searchExpanded = entries.filter((file) => file.kind === 'directory').map((file) => file.relPath);
        },
        error: (error) => {
          entry.error = errorDiagnosticOf(error).message;
        },
        settled: () => {
          entry.loading = false;
        },
      });
    }
  }
  async function refreshSources() {
    await reads.consume('sources', {}, queryCodeEditorSources, {
      ready: (value) => {
        sources.value = value;
        problem.value = '';
        directories.revoke(({ sessionId }) => !value.sources.some((source) => source.sessionId === sessionId));
        const next = value.sources.map((source) => {
          const current = find(source.sessionId);
          if (current) {
            current.source = source;
            return current;
          }
          return branch(source);
        });
        branches.splice(0, branches.length, ...next);
      },
      error: (error) => {
        problem.value = errorDiagnosticOf(error).message;
      },
    });
    await Promise.all(branches.filter((entry) => entry.opened).map((entry) => load(entry)));
  }
  async function refresh() {
    await refreshSources();
    if (searchText.value.trim()) return search();
    await Promise.all(branches.flatMap((entry) => [...entry.directories.keys()].map((directory) => load(entry, directory, true))));
  }
  async function toggle(entry: CodeProjectBranch) {
    entry.opened = !entry.opened;
    if (entry.opened) {
      await load(entry);
      if (searchText.value.trim()) await search();
    }
  }
  function expand(entry: CodeProjectBranch, keys: Array<string | number>) {
    if (searchText.value.trim()) {
      entry.searchExpanded = keys.map(String);
      return;
    }
    entry.expanded = keys.map(String);
    if (!searchText.value.trim()) for (const key of entry.expanded) void load(entry, key);
  }
  async function openFile(entry: CodeProjectBranch, path: string) {
    try {
      const target = await queryFileTextTarget(entry.source.sessionId, path);
      if (disposed || !target) return;
      if (entry.source.readOnly) await reference(target.path);
      else {
        const results = await host.openFiles([{ path: target.path }]);
        for (const result of results) if (result.diagnostic) feedback.error(result.diagnostic, '打开文件失败');
      }
    } catch (error) {
      if (!disposed) feedback.error(error, '打开文件失败');
    }
  }
  function open(entry: CodeProjectBranch, path: string) {
    const task = opening.then(() => (disposed ? undefined : openFile(entry, path)));
    opening = task;
    return task;
  }
  const ready = refreshSources();
  void listenSavedContent((event) => [
    async () => {
      await refreshSources();
      if (searchText.value.trim()) return search();
      for (const entry of branches) {
        const update = event.result.sessionUpdates.find((item) => item.sessionId === entry.source.sessionId);
        if (!update) continue;
        const paths = update.content.invalidation.paths
          .filter((path) => !isAbsoluteFsPath(path) || pathBelongsToRoot(path, entry.source.modRoot))
          .map((path) => (isAbsoluteFsPath(path) ? relativePathFromRoot(entry.source.modRoot, path) : path));
        const affected = update.content.invalidation.session
          ? [...entry.directories.keys()]
          : affectedFileDirectories(entry.directories, paths);
        for (const directory of affected) await load(entry, directory, true);
      }
    },
  ])
    .then((release) => {
      if (disposed) release();
      else stop = release;
    })
    .catch((error) => feedback.error(error, '监听项目来源失败'));
  onScopeDispose(() => {
    disposed = true;
    clearTimeout(timer);
    directories.revoke();
    stop?.();
    branches.splice(0);
  });
  return {
    sources,
    branches,
    problem,
    searchText,
    ready,
    nodes,
    load,
    expand,
    toggle,
    open,
    refresh,
    search,
    expanded: (entry: CodeProjectBranch) => (searchText.value.trim() ? entry.searchExpanded : entry.expanded),
    selected: (entry: CodeProjectBranch) => (searchText.value.trim() ? entry.searchSelected : entry.selected),
    select(entry: CodeProjectBranch, keys: Array<string | number>) {
      if (searchText.value.trim()) entry.searchSelected = keys.map(String);
      else entry.selected = keys.map(String);
    },
    setSearch(value: string) {
      searchText.value = value;
      clearTimeout(timer);
      timer = setTimeout(() => void search().catch((error) => feedback.error(error)), 250);
    },
    analysisRoots: computed<string[]>((previous) => {
      const roots = sources.value?.analysisRoots ?? [];
      return previous?.length === roots.length && previous.every((root, index) => root === roots[index]) ? previous : roots;
    }),
    settle: () => opening,
  };
}
