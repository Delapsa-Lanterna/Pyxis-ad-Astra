import { describe, expect, it, vi } from 'vitest';
import {
  createModFileTreeProjection,
  sortModFiles,
  modFileTree,
  visibleModFiles,
  affectedModDirectories,
  modFileType,
  modFileSize,
  modFileTime,
  modFileSearchTree,
} from './file-tree';
import type { ModDirectoryState, ModFileEntry } from '@/shared/types/mod-file-browser.types';
const entry = (relPath: string, kind: ModFileEntry['kind'] = 'file'): ModFileEntry => ({
  name: relPath.split('/').at(-1)!,
  relPath,
  kind,
  sizeBytes: kind === 'file' ? 16 : null,
  modifiedAt: 1700000000000,
});
describe('mod directory projections', () => {
  it('orders folders before naturally sorted filenames', () => {
    expect(sortModFiles([entry('file10'), entry('z', 'directory'), entry('file2'), entry('.hidden')]).map((item) => item.name)).toEqual([
      'z',
      '.hidden',
      'file2',
      'file10',
    ]);
  });
  it('keeps siblings visible while expanding nested folders and represents empty folders', () => {
    const directories = new Map<string | null, ModDirectoryState>([
      [null, { entries: [entry('data', 'directory'), entry('README')], loading: false, error: '' }],
      ['data', { entries: [entry('data/empty', 'directory')], loading: false, error: '' }],
      ['data/empty', { entries: [], loading: false, error: '' }],
    ]);
    const tree = modFileTree(directories);
    expect(visibleModFiles(tree, ['data', 'data/empty']).map((node) => node.key)).toEqual(['data', 'data/empty', 'README']);
    expect(tree[0]!.children![0]!.children![0]).toMatchObject({ label: '空文件夹', disabled: true });
    expect(affectedModDirectories(directories, ['data/empty'])).toEqual(['data', 'data/empty']);
  });
});

describe('file metadata and sorting', () => {
  it('formats byte units, extensions, zero size and local timestamps', () => {
    expect(modFileType(entry('README'))).toBe('文件');
    expect(modFileType(entry('abc.wpn'))).toBe('WPN 文件');
    expect(modFileType(entry('data', 'directory'))).toBe('文件夹');
    expect([0, 1024, 1024 ** 2, 1024 ** 3, null].map(modFileSize)).toEqual(['0 B', '1 KiB', '1 MiB', '1 GiB', '—']);
    expect(modFileTime(new Date(2025, 0, 2, 3, 4, 5).getTime())).toBe('2025-01-02 03:04:05');
    expect(modFileTime(null)).toBe('—');
  });
  it.each([true, false])('sorts siblings by size with folders first and missing values last, ascending=%s', (ascending) => {
    const files = [
      { ...entry('z'), sizeBytes: null },
      { ...entry('b'), sizeBytes: 5 },
      { ...entry('a'), sizeBytes: 5 },
      { ...entry('c'), sizeBytes: 10 },
      entry('folder', 'directory'),
    ];
    expect(sortModFiles(files, { key: 'size', ascending }).map((file) => file.name)).toEqual(
      ascending ? ['folder', 'a', 'b', 'c', 'z'] : ['folder', 'c', 'a', 'b', 'z'],
    );
  });
  it('applies type and time sorting to each tree level', () => {
    const directories = new Map<string | null, ModDirectoryState>([
      [null, { entries: [entry('data', 'directory'), entry('b.json'), entry('a.txt')], loading: false, error: '' }],
      [
        'data',
        {
          entries: [
            { ...entry('data/b'), modifiedAt: 20 },
            { ...entry('data/a'), modifiedAt: 10 },
          ],
          loading: false,
          error: '',
        },
      ],
    ]);
    expect(modFileTree(directories, null, { key: 'type', ascending: true }).map((node) => node.key)).toEqual(['data', 'b.json', 'a.txt']);
    expect(modFileTree(directories, null, { key: 'modified', ascending: false })[0]!.children!.map((node) => node.key)).toEqual([
      'data/b',
      'data/a',
    ]);
  });
  it('constructs a sparse result tree containing matches and their ancestors', () => {
    const result = {
      query: '船',
      entries: [entry('data', 'directory'), entry('data/hulls', 'directory'), entry('data/hulls/船.ship'), entry('船目录', 'directory')],
      matchedPaths: ['data/hulls/船.ship', '船目录'],
    };
    const tree = modFileSearchTree(result, { key: 'name', ascending: true });
    const nested = tree.find((node) => node.key === 'data')!;
    expect(nested.matched).toBe(false);
    expect(nested.children![0]!.children![0]).toMatchObject({ key: 'data/hulls/船.ship', matched: true });
    expect(tree.find((node) => node.key === '船目录')!.children![0]!.label).toBe('无匹配子项');
  });
});

describe('cached visible directory projection', () => {
  it('sorts each changed directory once and formats each stable entry once', () => {
    const { directories, projection, project } = setup();
    const reads = [...directories.values()]
      .flatMap((state) => state.entries!)
      .map((item) => {
        const read = vi.fn(() => 1700000000000);
        Object.defineProperty(item, 'modifiedAt', { get: read });
        return read;
      });
    const sorts = vi.spyOn(Array.prototype, 'sort');
    try {
      project(['data', 'other']);
      expect(sorts).toHaveBeenCalledTimes(3);
      for (const read of reads) expect(read).toHaveBeenCalledTimes(1);
      project(['data', 'other']);
      expect(sorts).toHaveBeenCalledTimes(3);
      for (const read of reads) expect(read).toHaveBeenCalledTimes(1);
      directories.get('data')!.entries = [entry('data/replacement')];
      project(['data', 'other']);
      expect(sorts).toHaveBeenCalledTimes(4);
      for (const read of reads) expect(read).toHaveBeenCalledTimes(1);
      projection.clear();
      project(['data', 'other']);
      expect(sorts).toHaveBeenCalledTimes(7);
      for (const read of reads.slice(0, 3)) expect(read).toHaveBeenCalledTimes(2);
    } finally {
      sorts.mockRestore();
    }
  });
  function setup() {
    const directories = new Map<string | null, ModDirectoryState>([
      [null, { entries: [entry('data', 'directory'), entry('other', 'directory'), entry('README')], loading: false, error: '' }],
      ['data', { entries: [entry('data/spec.wpn')], loading: false, error: '' }],
      ['other', { entries: [], loading: false, error: '' }],
    ]);
    const projection = createModFileTreeProjection();
    const project = (expanded: string[] = [], ascending = true) => projection.project(directories, expanded, { key: 'name', ascending });
    return { directories, projection, project };
  }
  it('keeps collapsed caches out of display and preserves unchanged array and sibling identities', () => {
    const { directories, project } = setup();
    const collapsed = project();
    expect(collapsed[0]!.children).toEqual([]);
    directories.get('data')!.entries = [entry('data/new.wpn')];
    expect(project()).toBe(collapsed);
    const expanded = project(['data']);
    expect(expanded[0]!.children![0]!.key).toBe('data/new.wpn');
    expect(expanded[1]).toBe(collapsed[1]);
    expect(expanded[2]).toBe(collapsed[2]);
    expect(project(['data'])).toBe(expanded);
    directories.get('data')!.entries = [entry('data/changed.wpn')];
    const changed = project(['data']);
    expect(changed[0]).not.toBe(expanded[0]);
    expect(changed[1]).toBe(expanded[1]);
    expect(changed[2]).toBe(expanded[2]);
  });
  it('projects sorting and empty-directory rows while reusing formatted file nodes', () => {
    const { project } = setup();
    const before = project(['other']);
    expect(before[1]!.children![0]).toMatchObject({ label: '空文件夹', disabled: true });
    const reverse = project(['other'], false);
    expect(reverse.map((node) => node.key)).toEqual(['other', 'data', 'README']);
    expect(reverse[2]).toBe(before[2]);
    expect(reverse[0]!.children).toBe(before[1]!.children);
  });
  it('replaces a previously nonempty directory with its empty status row', () => {
    const { directories, project } = setup();
    project(['data']);
    directories.get('data')!.entries = [];
    const empty = project(['data']);
    expect(empty[0]!.children).toEqual([{ key: 'status:data', label: '空文件夹', isLeaf: true, disabled: true, kind: 'status' }]);
    expect(project(['data'])).toBe(empty);
  });
  it('releases removed subtree projections and clears window-scoped identities', () => {
    const { directories, projection, project } = setup();
    const before = project(['data']);
    directories.delete('data');
    projection.forget(['data']);
    expect(project(['data'])[0]!.children).toEqual([]);
    directories.set('data', { entries: [entry('data/recreated')], loading: false, error: '' });
    expect(project(['data'])[0]!.children![0]!.key).toBe('data/recreated');
    projection.clear();
    expect(project(['data'])[2]).not.toBe(before[2]);
  });
});
