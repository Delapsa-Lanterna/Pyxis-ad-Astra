import type { CsvDraftRow, CsvTableIndex, CsvTableRows, CsvModState, CsvTableKey, RowData } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';

export function csvDraftRow(content: RowData, rowKey: string, isComment = false): CsvDraftRow {
  return { data: deepClone(content), isComment, rowKey };
}

export function csvTableIndex(rows: CsvDraftRow[], options: Partial<Omit<CsvTableIndex, 'rows'>> = {}): CsvTableIndex {
  return {
    table: 'ships',
    baseVersions: [],
    header: Object.keys(rows[0]?.data ?? {}),
    totalRows: rows.length,
    rowKeys: rows.map((row) => row.rowKey),
    rows,
    ...options,
  };
}

export function csvRows(state: CsvModState, baseline = false, table: CsvTableKey = 'ships'): CsvTableRows {
  const keys = baseline ? state.documents[table].baselineRowOrder : state.documents[table].rowOrder;
  const rows = baseline ? state.documents[table].baselineRows : state.documents[table].rows;
  return keys.map((key) => rows[key] ?? null);
}
