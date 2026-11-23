import { pathBasename, pathBelongsToRoot, relativePathFromRoot } from '@/shared/lib/paths';

export function fileTabLabels(paths: string[], root: string): Map<string, string> {
  const labels = new Map(paths.map((path) => [path, pathBasename(path)]));
  const names = new Set<string>(),
    duplicates = new Set<string>();
  for (const name of labels.values()) {
    if (names.has(name)) duplicates.add(name);
    names.add(name);
  }
  for (const [path, name] of labels)
    if (duplicates.has(name)) labels.set(path, pathBelongsToRoot(path, root) ? relativePathFromRoot(root, path) : path);
  return labels;
}

export function fileTabStatus(dirty: boolean, error: boolean, saving: boolean, readOnly: boolean) {
  if (dirty) return { className: 'mod-tab-dirty', label: '有未保存修改' };
  if (error) return { className: 'mod-tab-status error', label: '文件处理失败' };
  if (saving) return { className: 'mod-tab-status loading', label: '保存中' };
  return { className: 'mod-tab-status', label: readOnly ? '只读' : '已保存' };
}
