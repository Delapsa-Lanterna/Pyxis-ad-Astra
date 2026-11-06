import type { ProjectSessionId, ResourceRef, CsvTableKey, FileVersion, EntityKind } from '@/shared/types/project-identity.types';
import type { RowData } from '@/shared/types/json.types';

export interface CsvTableState {
  table: CsvTableKey;
  nextRowKey: number;
  validationRows: CsvRowRecord[] | null;
  validationContext: CsvValidationContext | null;
  validationKey: string;
  rowOrder: string[];
  baselineRowOrder: string[];
  queryRowKeys?: string[];
  baseVersions: FileVersion[];
  rows: Record<string, CsvDraftRow>;
  baselineRows: Record<string, CsvDraftRow>;
  header: string[];
  totalRowCount: number;
  filteredRowCount: number;
  dirty: Record<string, CsvDirtyRow>;
  externalUpdatePending: boolean;
}

export interface CsvModState {
  documents: Record<CsvTableKey, CsvTableState>;
  currentTab: CsvTableKey;
  searchField: CsvSearchField;
  searchText: string;
  selectedRowKey: string | null;
  editing: CsvCellTarget | null;
}

export interface CsvTableTarget {
  sessionId: string;
  modRoot: string;
  table: CsvTableKey;
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

export type CsvDraftRow = CsvRowRecord;

export type CsvTableRows = Array<CsvDraftRow | null>;

export interface CsvTableIndex {
  validationRows: CsvRowRecord[];
  baseVersions: FileVersion[];
  table: CsvTableKey;
  header: string[];
  totalRows: number;
  rowKeys: string[];
  rows: CsvRowRecord[];
}

export interface CsvValidationRequest {
  entities: Array<{ kind: EntityKind; id: string }>;
  sources: string[];
  files: string[];
  classes: string[];
  stationData: string[];
}
export interface CsvValidationContext {
  complete: boolean;
  entities: Record<string, RowData>;
  sources: Record<string, string[]>;
  files: Record<string, boolean>;
  classes: Record<string, boolean>;
  stationData: Record<string, { value: RowData | null; error: string | null }>;
}

export interface CsvTableRowsRead {
  baseVersions: FileVersion[];
  table: CsvTableKey;
  rows: CsvRowRecord[];
}

export interface CsvTableIndexPayload {
  sessionId: ProjectSessionId;
  table: CsvTableKey;
  initialCount: number;
  validationColumns: string[];
  search: string | null;
  searchField: CsvSearchField;
}

export interface CsvTableRowsPayload {
  sessionId: ProjectSessionId;
  table: CsvTableKey;
  rowKeys: string[];
}

export interface CsvRowPreview {
  resourceRef: ResourceRef | null;
}

export interface CsvRowPreviewTarget {
  rowKey: string;
  sessionId: ProjectSessionId;
  table: CsvTableKey;
}

export interface CsvRowPreviewPayload {
  sessionId: string;
  table: CsvTableKey;
  rowKey: string;
}
