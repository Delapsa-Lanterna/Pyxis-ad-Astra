import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useModFileBrowserStore } from './mod-file-browser.store';
import type { ModFileEntry } from '@/shared/types';

const entry = (relPath: string, kind: ModFileEntry['kind'] = 'file'): ModFileEntry => ({
  name: relPath.split('/').at(-1)!,
  relPath,
  kind,
  sizeBytes: kind === 'file' ? 16 : null,
  modifiedAt: 1000,
});
beforeEach(() => setActivePinia(createPinia()));

describe('directory cache identity', () => {
  it('retains identical listings and entries across enumeration order and metadata updates', () => {
    const store = useModFileBrowserStore();
    const state = store.establish('s1', 'M:/A');
    store.acceptDirectory('s1', { directory: null, entries: [entry('a'), entry('b')] });
    const before = state.directories.get(null)!.entries!;
    store.acceptDirectory('s1', { directory: null, entries: [entry('b'), entry('a')] });
    expect(state.directories.get(null)!.entries).toBe(before);
    store.acceptDirectory('s1', { directory: null, entries: [entry('a'), { ...entry('b'), sizeBytes: 30, modifiedAt: 2000 }] });
    const after = state.directories.get(null)!.entries!;
    expect(after).not.toBe(before);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toMatchObject({ sizeBytes: 30, modifiedAt: 2000 });
  });
  it('cleans removed directory state while retaining other sessions and valid browser state', () => {
    const store = useModFileBrowserStore();
    const state = store.establish('s1', 'M:/A');
    const other = store.establish('s2', 'M:/B');
    store.acceptDirectory('s1', { directory: null, entries: [entry('data', 'directory'), entry('other', 'directory')] });
    store.acceptDirectory('s1', { directory: 'data', entries: [entry('data/nested', 'directory')] });
    store.acceptDirectory('s1', { directory: 'data/nested', entries: [] });
    state.expanded = ['data', 'data/nested', 'other'];
    state.selected = 'data/nested';
    state.scrollTop = 50;
    const removed = store.acceptDirectory('s1', { directory: null, entries: [entry('data'), entry('other', 'directory')] });
    expect(removed).toEqual(['data']);
    expect([...state.directories.keys()]).toEqual([null]);
    expect(state.expanded).toEqual(['other']);
    expect(state.selected).toBe(null);
    expect(state.scrollTop).toBe(50);
    expect(store.sessions.get('s2')).toBe(other);
  });
});
