import type { CsvTableKey } from '@/shared/types';

export function createTableRowKey(table: CsvTableKey, sequence: number): string {
  return `${table}:new:${sequence}`;
}
