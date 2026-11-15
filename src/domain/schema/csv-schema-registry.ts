import { TABLE_KEYS, type CsvTableKey } from '@/shared/types';
import type { CsvColumnSchema } from '@/domain/schema/schema.types';
import { parseCsvColumnSchemas } from '@/domain/schema/schema-asset-parser';
import { validateOptionCatalog } from './value-catalogs';

const assets = import.meta.glob<unknown>('../../../schemas/csv/*.schema.json', { eager: true, import: 'default' });
const CSV_COLUMN_SCHEMAS = Object.fromEntries(
  TABLE_KEYS.map((table) => {
    const columns = parseCsvColumnSchemas(table, assets['../../../schemas/csv/' + table + '.schema.json']);
    columns.forEach(validateOptionCatalog);
    return [table, columns];
  }),
) as Record<CsvTableKey, CsvColumnSchema[]>;

export function getCsvColumnSchemas(table: CsvTableKey): CsvColumnSchema[] {
  return CSV_COLUMN_SCHEMAS[table] ?? [];
}
