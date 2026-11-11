import { pathBasename } from '@/shared/lib/paths';

export function tabLabel(path: string, paths: string[], root: string): string {
  const name = pathBasename(path);
  if (paths.filter((other) => pathBasename(other) === name).length < 2) return name;
  return path.slice(root.length).replace(/^[\\/]/, '');
}

export function fileTabStatus(dirty: boolean, error: boolean, saving: boolean, readOnly: boolean) {
  if (dirty) return { className: 'mod-tab-dirty', label: '有未保存修改' };
  if (error) return { className: 'mod-tab-status error', label: '文件处理失败' };
  if (saving) return { className: 'mod-tab-status loading', label: '保存中' };
  return { className: 'mod-tab-status', label: readOnly ? '只读' : '已保存' };
}
