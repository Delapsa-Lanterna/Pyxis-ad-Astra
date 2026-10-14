import { describe, expect, it } from 'vitest';
import {
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
