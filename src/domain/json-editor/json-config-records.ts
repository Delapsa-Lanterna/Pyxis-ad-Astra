import { requireRowData } from '@/shared/lib/row-data';
import { AppError } from '@/shared/lib/errors';
import type { IndexedConfigEntityData, RowData, WriteResult } from '@/shared/types';

export interface ConfigFactionPreviewImages {
  logoSrc: string;
  crestSrc: string;
}

export function indexedConfigEntityData(result: WriteResult): IndexedConfigEntityData {
  const row = requireRowData(result.refreshedEntity, '配置保存返回数据无效');
  return {
    baseVersions: result.baseVersions,
    entityId: stringField(row, 'entityId', '配置保存返回 entityId 无效'),
    indexPath: stringField(row, 'indexPath', '配置保存返回 indexPath 无效'),
    indexHeader: stringArrayField(row, 'indexHeader', '配置保存返回 indexHeader 无效'),
    indexRows: rowDataArrayField(row, 'indexRows', '配置保存返回 indexRows 无效').map((record) => {
      if (typeof record.isComment !== 'boolean') throw new AppError('配置保存返回注释标记无效', { action: 'read-config-entity' });
      return { data: requireRowData(record.data, '配置保存返回行内容无效'), isComment: record.isComment };
    }),
    entityData: row.entityData === null ? null : requireRowData(row.entityData, '配置保存返回 entityData 无效'),
  };
}

function stringField(row: RowData, key: string, message: string): string {
  const value = row[key];
  if (typeof value === 'string') return value;
  throw new AppError(message, { action: 'read-config-entity' });
}

function stringArrayField(row: RowData, key: string, message: string): string[] {
  const value = row[key];
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) return value;
  throw new AppError(message, { action: 'read-config-entity' });
}

function rowDataArrayField(row: RowData, key: string, message: string): RowData[] {
  const value = row[key];
  if (Array.isArray(value)) return value.map((item) => requireRowData(item, message));
  throw new AppError(message, { action: 'read-config-entity' });
}
