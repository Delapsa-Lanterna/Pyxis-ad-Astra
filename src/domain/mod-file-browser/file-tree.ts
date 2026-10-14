import type { ModDirectoryState, ModFileEntry, ModFileSearch, ModFileSort } from '@/shared/types';
export interface ModFileNode {
  key: string;
  label: string;
  isLeaf: boolean;
  disabled: boolean;
  kind: ModFileEntry['kind'] | 'status';
  children?: ModFileNode[];
  typeText?: string;
  sizeText?: string;
  modifiedText?: string;
  matched?: boolean;
}
const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });

export function modFileType(entry: Pick<ModFileEntry, 'name' | 'kind'>) {
  if (entry.kind === 'directory') return '文件夹';
  if (entry.kind === 'restricted') return '受限条目';
  const dot = entry.name.lastIndexOf('.');
  return dot > 0 && dot < entry.name.length - 1 ? entry.name.slice(dot + 1).toUpperCase() + ' 文件' : '文件';
}
export function modFileSize(bytes: number | null) {
  if (bytes === null) return '—';
  const unit = Math.min(3, bytes === 0 ? 0 : Math.floor(Math.log(bytes) / Math.log(1024)));
  return (bytes / 1024 ** unit).toLocaleString('zh-CN', { maximumFractionDigits: unit ? 2 : 0 }) + ' ' + ['B', 'KiB', 'MiB', 'GiB'][unit];
}
export function modFileTime(time: number | null) {
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
export function sortModFiles(entries: readonly ModFileEntry[], sort: ModFileSort = { key: 'name', ascending: true }): ModFileEntry[] {
  const value = (entry: ModFileEntry) =>
    sort.key === 'name' ? entry.name : sort.key === 'type' ? modFileType(entry) : sort.key === 'size' ? entry.sizeBytes : entry.modifiedAt;
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
export function modFileTree(
  directories: ReadonlyMap<string | null, ModDirectoryState>,
  directory: string | null = null,
  sort: ModFileSort = { key: 'name', ascending: true },
): ModFileNode[] {
  return sortModFiles(directories.get(directory)?.entries ?? [], sort).map((entry) => {
    const state = directories.get(entry.relPath);
    const children = entry.kind === 'directory' ? modFileTree(directories, entry.relPath, sort) : undefined;
    if (children && state?.entries && children.length === 0)
      children.push({ key: 'status:' + entry.relPath, label: '空文件夹', isLeaf: true, disabled: true, kind: 'status' });
    return {
      key: entry.relPath,
      label: entry.name,
      isLeaf: entry.kind !== 'directory',
      disabled: entry.kind === 'restricted',
      kind: entry.kind,
      typeText: modFileType(entry),
      sizeText: modFileSize(entry.sizeBytes),
      modifiedText: modFileTime(entry.modifiedAt),
      ...(children ? { children } : {}),
    };
  });
}
export function visibleModFiles(nodes: readonly ModFileNode[], expanded: readonly string[]): ModFileNode[] {
  return nodes.flatMap((node) => [
    ...(node.kind === 'status' ? [] : [node]),
    ...(expanded.includes(node.key) ? visibleModFiles(node.children ?? [], expanded) : []),
  ]);
}
export function affectedModDirectories(
  directories: ReadonlyMap<string | null, ModDirectoryState>,
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

export function modFileSearchTree(result: ModFileSearch, sort: ModFileSort): ModFileNode[] {
  const directories = new Map<string | null, ModDirectoryState>([[null, { entries: [], loading: false, error: '' }]]);
  for (const entry of result.entries)
    if (entry.kind === 'directory') directories.set(entry.relPath, { entries: [], loading: false, error: '' });
  for (const entry of result.entries) {
    const slash = entry.relPath.lastIndexOf('/');
    directories.get(slash < 0 ? null : entry.relPath.slice(0, slash))!.entries!.push(entry);
  }
  const tree = modFileTree(directories, null, sort);
  const matches = new Set(result.matchedPaths);
  function mark(nodes: ModFileNode[]) {
    for (const node of nodes) {
      node.matched = matches.has(node.key);
      if (node.kind === 'status') node.label = '无匹配子项';
      if (node.children) mark(node.children);
    }
  }
  mark(tree);
  return tree;
}
