import type { CsvDraftRow, CsvTableIndex, CsvTableRows, ModTableState, RowData } from '@/shared/types';
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

export function csvRows(state: ModTableState, baseline = false): CsvTableRows {
  const keys = baseline ? state.originalRowOrders.ships : state.rowOrders.ships;
  const rows = baseline ? state.originalTables.ships : state.tables.ships;
  return keys.map((key) => rows[key] ?? null);
}
