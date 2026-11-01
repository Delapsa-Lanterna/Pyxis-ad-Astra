import type { JsonEntityFile, RowData, WriteResult, EntityEditTarget, FileVersion } from '@/shared/types';
import { requireRowData } from '@/shared/lib/row-data';

export function jsonEntitySavedData(result: WriteResult): JsonEntityFile {
  const record = requireRowData(result.content?.value, 'JSON 实体保存数据无效');
  return jsonEntityFile(result.identityChanges[0]!.after, result.baseVersions, requireRowData(record.data, 'JSON 实体文件内容无效'));
}

function jsonEntityFile(target: EntityEditTarget, baseVersions: FileVersion[], data: RowData): JsonEntityFile {
  return { target, baseVersions, id: target.id, path: target.write.path, relPath: target.write.relPath, data };
}
