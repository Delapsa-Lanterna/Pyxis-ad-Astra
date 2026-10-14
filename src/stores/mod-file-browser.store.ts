import { defineStore } from 'pinia';
import { reactive } from 'vue';
import type { ModDirectory, ModFileBrowserState, ModDirectoryState } from '@/shared/types';
export const useModFileBrowserStore = defineStore('mod-file-browser', () => {
  const sessions = reactive(new Map<string, ModFileBrowserState>());
  function establish(sessionId: string, modRoot: string) {
    if (!sessions.has(sessionId))
      sessions.set(sessionId, {
        modRoot,
        directories: new Map(),
        expanded: [],
        selected: null,
        scrollTop: 0,
        sort: { key: 'name', ascending: true },
        search: { text: '', result: null, loading: false, error: '', expanded: [], selected: null, scrollTop: 0 },
      });
    return sessions.get(sessionId)!;
  }
  function directoryState(sessionId: string, directory: string | null): ModDirectoryState {
    const state = sessions.get(sessionId)!;
    if (!state.directories.has(directory)) state.directories.set(directory, { entries: null, loading: false, error: '' });
    return state.directories.get(directory)!;
  }
  function acceptDirectory(sessionId: string, result: ModDirectory) {
    const state = sessions.get(sessionId)!;
    const previous = directoryState(sessionId, result.directory);
    const removed: string[] = [];
    const directories = new Set(result.entries.filter((entry) => entry.kind === 'directory').map((entry) => entry.relPath));
    for (const entry of previous.entries ?? []) {
      if (entry.kind === 'directory' && !directories.has(entry.relPath)) {
        removed.push(entry.relPath);
        for (const key of [...state.directories.keys()])
          if (key !== null && (key === entry.relPath || key.startsWith(entry.relPath + '/'))) state.directories.delete(key);
        state.expanded = state.expanded.filter((path) => path !== entry.relPath && !path.startsWith(entry.relPath + '/'));
        if (state.selected === entry.relPath || state.selected?.startsWith(entry.relPath + '/')) state.selected = null;
      }
    }
    if (
      state.selected &&
      previous.entries?.some((entry) => entry.relPath === state.selected) &&
      !result.entries.some((entry) => entry.relPath === state.selected)
    )
      state.selected = null;
    previous.entries = result.entries;
    previous.error = '';
    return removed;
  }
  function removeModState(modRoot: string) {
    for (const [id, state] of sessions) if (state.modRoot === modRoot) sessions.delete(id);
  }
  return { sessions, establish, directoryState, acceptDirectory, removeModState };
});
