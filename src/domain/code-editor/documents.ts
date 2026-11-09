import { pathBasename } from '@/shared/lib/paths';

export function tabLabel(path: string, paths: string[], root: string): string {
  const name = pathBasename(path);
  if (paths.filter((other) => pathBasename(other) === name).length < 2) return name;
  return path.slice(root.length).replace(/^[\\/]/, '');
}
