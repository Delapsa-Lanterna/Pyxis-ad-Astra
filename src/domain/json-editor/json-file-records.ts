import type { JsonEntityFile, WriteResult, VariantFile, SkinFile } from '@/shared/types';
import { requireRowData } from '@/shared/lib/row-data';

export function jsonEntitySavedData(result: WriteResult<VariantFile | SkinFile>): JsonEntityFile {
  const record = result.content!.value,
    target = result.identityChanges[0]!.after;
  return {
    target,
    baseVersions: result.baseVersions,
    id: target.id,
    path: target.write.path,
    relPath: target.write.relPath,
    data: requireRowData(record.data, 'JSON 实体文件内容无效'),
    document: record.document!,
  };
}
