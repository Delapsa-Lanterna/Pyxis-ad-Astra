import type { CsvTableKey } from '@/shared/types/project-identity.types';
import type { CsvDraftRow } from '@/shared/types/tables.types';

export interface CsvCellValueSetEdit {
  type: 'cell-value-set';
  tab: CsvTableKey;
  rowKey: string;
  col: string;
  previousValue: string;
  newValue: string;
  previousIsComment: boolean;
  newIsComment: boolean;
}

export interface CsvRowCreatedEdit {
  type: 'row-created';
  tab: CsvTableKey;
  rowKey: string;
  rowIndex: number;
  row: CsvDraftRow;
}

export interface CsvRowDeletedEdit {
  type: 'row-deleted';
  tab: CsvTableKey;
  rowKey: string;
  rowIndex: number;
  row: CsvDraftRow;
}

export interface CsvRowMovedEdit {
  type: 'row-moved';
  tab: CsvTableKey;
  rowKey: string;
  previousIndex: number;
  nextIndex: number;
}

export type CsvSingleEdit = CsvCellValueSetEdit | CsvRowCreatedEdit | CsvRowDeletedEdit | CsvRowMovedEdit;
export interface CsvBatchEdit {
  type: 'batch';
  tab: CsvTableKey;
  rowKey: string;
  edits: CsvSingleEdit[];
}
export type CsvDraftEdit = CsvSingleEdit | CsvBatchEdit;

export interface CsvTableHistoryEntry {
  id: string;
  timestamp: number;
  edit: CsvDraftEdit;
  label: string;
}
