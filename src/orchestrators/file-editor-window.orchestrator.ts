import type { WriteResult } from '@/shared/types';
import { joinRootRelativePath, normalizeFsPath, pathBelongsToRoot } from '@/shared/lib/paths';
import { isRowData } from '@/shared/lib/row-data';
export function committedFileText(result: WriteResult<unknown>, path: string): string | undefined {
  const content = result.content;
  if (
    content?.target.kind === 'text' &&
    normalizeFsPath(content.target.path) === normalizeFsPath(path) &&
    isRowData(content.value) &&
    typeof content.value.text === 'string'
  )
    return content.value.text;
  for (const change of result.changes) {
    if (change.kind === 'directory' && pathBelongsToRoot(path, change.afterPath)) {
      const matches = (file: { relPath: string }) =>
        normalizeFsPath(joinRootRelativePath(change.afterPath, file.relPath)) === normalizeFsPath(path);
      const after = change.afterFiles.find(matches);
      if (after?.dataBase64) return;
      if (after) return after.text ?? '';
      if (change.beforeFiles.some(matches)) return '';
    } else if (
      normalizeFsPath(change.afterPath) === normalizeFsPath(path) &&
      !change.afterDataBase64 &&
      (!change.beforeDataBase64 || change.afterText !== null)
    )
      return change.afterText ?? '';
  }
}
