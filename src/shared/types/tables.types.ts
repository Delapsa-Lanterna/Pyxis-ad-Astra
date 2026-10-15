import type { ProjectSessionId, ResourceRef, TableKey } from '@/shared/types/project-identity.types';
import type { RowData } from '@/shared/types/json.types';

export interface CsvTableTarget {
  sessionId: string;
  modRoot: string;
  table: TableKey;
}

export interface CsvCellTarget extends CsvTableTarget {
  rowKey: string;
  column: string;
}

export type CsvSearchField = 'id-name' | 'id' | 'name' | 'tags';

export type CsvDirtyRow = { action: 'upsert'; cells: Record<string, string> } | { action: 'delete' };

export interface CsvRow {
  data: RowData;
  isComment: boolean;
}

export interface CsvRowRecord extends CsvRow {
  rowKey: string;
}

export interface CsvDraftRow extends CsvRowRecord {
  sourceRowIndex: number | null;
  insertAt: number | null;
}

export type CsvTableRows = Array<CsvDraftRow | null>;

export interface CsvTableWindow {
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  table: TableKey;
  header: string[];
  totalRows: number;
  filteredRows: number;
  start: number;
  rows: CsvWindowRow[];
}

export interface CsvWindowRow extends CsvRowRecord {
  sourceRowIndex: number;
}

export interface CsvPlaceholderRowSlot {
  kind: 'placeholder';
  rowIndex: number;
  slotKey: string;
}

export interface CsvLoadedRowSlot extends CsvDraftRow {
  kind: 'row';
  rowIndex: number;
}

export type CsvGridRowSlot = CsvLoadedRowSlot | CsvPlaceholderRowSlot;

export interface CsvRowPreview {
  resourceRef: ResourceRef | null;
}

export interface CsvRowPreviewTarget {
  rowKey: string;
  sessionId: ProjectSessionId;
  table: TableKey;
}
