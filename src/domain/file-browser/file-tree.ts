import type { FileDirectoryState, FileEntry, FileSearch, FileSort } from '@/shared/types';
export type FileNode = {
  key: string;
  label: string;
  isLeaf: boolean;
  disabled: boolean;
  kind: FileEntry['kind'] | 'status';
  children?: FileNode[];
  typeText?: string;
  sizeText?: string;
  modifiedText?: string;
  matched?: boolean;
};
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function fileType(entry: Pick<FileEntry, 'name' | 'kind'>) {
  if (entry.kind === 'directory') return '文件夹';
  if (entry.kind === 'restricted') return '受限条目';
  const dot = entry.name.lastIndexOf('.');
  return dot > 0 && dot < entry.name.length - 1 ? entry.name.slice(dot + 1).toUpperCase() + ' 文件' : '文件';
}
export function fileSize(bytes: number | null) {
  if (bytes === null) return '—';
  const unit = Math.min(3, bytes === 0 ? 0 : Math.floor(Math.log(bytes) / Math.log(1024)));
  return (bytes / 1024 ** unit).toLocaleString('zh-CN', { maximumFractionDigits: unit ? 2 : 0 }) + ' ' + ['B', 'KiB', 'MiB', 'GiB'][unit];
}
export function fileTime(time: number | null) {
  if (time === null) return '—';
  const date = new Date(time),
    pad = (value: number) => String(value).padStart(2, '0');
  return (
    date.getFullYear() +
    '-' +
    pad(date.getMonth() + 1) +
    '-' +
    pad(date.getDate()) +
    ' ' +
    pad(date.getHours()) +
    ':' +
    pad(date.getMinutes()) +
    ':' +
    pad(date.getSeconds())
  );
}
export function sortFiles(entries: readonly FileEntry[], sort: FileSort = { key: 'name', ascending: true }): FileEntry[] {
  const value = (entry: FileEntry) =>
    sort.key === 'name' ? entry.name : sort.key === 'type' ? fileType(entry) : sort.key === 'size' ? entry.sizeBytes : entry.modifiedAt;
  return [...entries].sort((a, b) => {
    const folders = Number(b.kind === 'directory') - Number(a.kind === 'directory');
    if (folders) return folders;
    const left = value(a),
      right = value(b);
    const tie = collator.compare(a.name, b.name) || a.name.localeCompare(b.name);
    if (left === null || right === null) return left === right ? tie : left === null ? 1 : -1;
    const comparison = typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right));
    return (sort.ascending ? comparison : -comparison) || tie;
  });
}
export function fileTree(
  directories: ReadonlyMap<string | null, FileDirectoryState>,
  directory: string | null = null,
  sort: FileSort = { key: 'name', ascending: true },
): FileNode[] {
  return sortFiles(directories.get(directory)?.entries ?? [], sort).map((entry) => {
    const state = directories.get(entry.relPath);
    const children = entry.kind === 'directory' ? fileTree(directories, entry.relPath, sort) : undefined;
    if (children && state?.entries && children.length === 0)
      children.push({ key: 'status:' + entry.relPath, label: '空文件夹', isLeaf: true, disabled: true, kind: 'status' });
    return { ...fileNode(entry), ...(children ? { children } : {}) };
  });
}
function fileNode(entry: FileEntry): FileNode {
  return {
    key: entry.relPath,
    label: entry.name,
    isLeaf: entry.kind !== 'directory',
    disabled: entry.kind === 'restricted',
    kind: entry.kind,
    typeText: fileType(entry),
    sizeText: fileSize(entry.sizeBytes),
    modifiedText: fileTime(entry.modifiedAt),
  };
}

export function createFileTreeCache() {
  const cache = new Map<
    string | null,
    {
      entries: readonly FileEntry[] | null;
      sort: string;
      sorted: FileEntry[];
      nodes: FileNode[];
    }
  >();
  let labels = new WeakMap<FileEntry, FileNode>();
  const empty: FileNode[] = [];
  function project(directories: ReadonlyMap<string | null, FileDirectoryState>, expanded: readonly string[], sort: FileSort): FileNode[] {
    const open = new Set(expanded),
      sortKey = sort.key + ':' + sort.ascending;
    function visit(directory: string | null): FileNode[] {
      const entries = directories.get(directory)?.entries ?? null;
      const previous = cache.get(directory);
      const sorted = previous?.entries === entries && previous.sort === sortKey ? previous.sorted : sortFiles(entries ?? [], sort);
      const previousNodes = new Map(previous?.nodes.map((node) => [node.key, node]));
      const nodes = sorted.map((entry) => {
        let base = labels.get(entry);
        if (!base) {
          base = fileNode(entry);
          labels.set(entry, base);
        }
        if (entry.kind !== 'directory') return base;
        const children = open.has(entry.relPath) ? visit(entry.relPath) : empty;
        const old = previousNodes.get(entry.relPath);
        return old?.children === children &&
          old.label === base.label &&
          old.modifiedText === base.modifiedText &&
          old.typeText === base.typeText
          ? old
          : { ...base, children };
      });
      if (directory !== null && entries?.length === 0)
        nodes.push(
          previous?.nodes[0]?.kind === 'status'
            ? previous.nodes[0]
            : { key: 'status:' + directory, label: '空文件夹', isLeaf: true, disabled: true, kind: 'status' },
        );
      const result =
        previous?.nodes.length === nodes.length && nodes.every((node, index) => node === previous.nodes[index]) ? previous.nodes : nodes;
      cache.set(directory, { entries, sort: sortKey, sorted, nodes: result });
      return result;
    }
    return visit(null);
  }
  function forget(paths: readonly string[]) {
    for (const key of cache.keys()) if (key !== null && paths.some((path) => key === path || key.startsWith(path + '/'))) cache.delete(key);
  }
  function clear() {
    cache.clear();
    labels = new WeakMap();
  }
  return { project, forget, clear };
}
export function visibleFiles(nodes: readonly FileNode[], expanded: readonly string[]): FileNode[] {
  return nodes.flatMap((node) => [
    ...(node.kind === 'status' ? [] : [node]),
    ...(expanded.includes(node.key) ? visibleFiles(node.children ?? [], expanded) : []),
  ]);
}
export function affectedFileDirectories(
  directories: ReadonlyMap<string | null, FileDirectoryState>,
  paths: readonly string[],
): Array<string | null> {
  return [...directories.keys()]
    .filter((directory) =>
      paths.some((path) => {
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
        return directory === parent || (directory !== null && (directory === path || directory.startsWith(path + '/')));
      }),
    )
    .sort((a, b) => (a?.split('/').length ?? 0) - (b?.split('/').length ?? 0));
}

export function fileSearchTree(result: FileSearch, sort: FileSort): FileNode[] {
  const directories = new Map<string | null, FileDirectoryState>([[null, { entries: [], loading: false, error: '' }]]);
  for (const entry of result.entries)
    if (entry.kind === 'directory') directories.set(entry.relPath, { entries: [], loading: false, error: '' });
  for (const entry of result.entries) {
    const slash = entry.relPath.lastIndexOf('/');
    directories.get(slash < 0 ? null : entry.relPath.slice(0, slash))!.entries!.push(entry);
  }
  const tree = fileTree(directories, null, sort);
  const matches = new Set(result.matchedPaths);
  function mark(nodes: FileNode[]) {
    for (const node of nodes) {
      node.matched = matches.has(node.key);
      if (node.kind === 'status') node.label = '无匹配子项';
      if (node.children) mark(node.children);
    }
  }
  mark(tree);
  return tree;
}
