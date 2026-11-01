import type { CsvTableKey } from '@/shared/types/project-identity.types';
import type { CsvDraftRow } from '@/shared/types/tables.types';

export interface CsvCellValueSetOperation {
  type: 'cell-value-set';
  tab: CsvTableKey;
  rowKey: string;
  col: string;
  previousValue: string;
  newValue: string;
  previousIsComment: boolean;
  newIsComment: boolean;
}

export interface CsvRowCreatedOperation {
  type: 'row-created';
  tab: CsvTableKey;
  rowKey: string;
  rowIndex: number;
  row: CsvDraftRow;
}

export interface CsvRowDeletedOperation {
  type: 'row-deleted';
  tab: CsvTableKey;
  rowKey: string;
  rowIndex: number;
  row: CsvDraftRow;
}

export interface CsvRowMovedOperation {
  type: 'row-moved';
  tab: CsvTableKey;
  rowKey: string;
  previousIndex: number;
  nextIndex: number;
}

export type CsvSingleOperation = CsvCellValueSetOperation | CsvRowCreatedOperation | CsvRowDeletedOperation | CsvRowMovedOperation;
export interface CsvBatchOperation {
  type: 'batch';
  tab: CsvTableKey;
  rowKey: string;
  operations: CsvSingleOperation[];
}
export type CsvDraftOperation = CsvSingleOperation | CsvBatchOperation;

export interface CsvTableHistoryEntry {
  id: string;
  timestamp: number;
  operation: CsvDraftOperation;
  label: string;
}
