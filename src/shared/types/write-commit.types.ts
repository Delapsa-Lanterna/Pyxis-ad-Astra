import type { FileVersion } from '@/shared/types/project-identity.types';
import type { FileChangeRecord } from '@/shared/types/file-changes.types';
import type { RowData } from '@/shared/types/json.types';
import type { ProjectInvalidation, ProjectSessionInvalidationResult } from '@/shared/types/project-session.types';
import type { FileHistorySnapshot } from '@/shared/types/file-history.types';

export interface CsvRowKeyMapping {
  previousKey: string;
  nextKey: string;
  rowIndex: number;
}

export type SaveAcceptanceTask = () => void | boolean | SaveAcceptanceTask[] | Promise<void | boolean | SaveAcceptanceTask[]>;

export type SaveEdit = { path: string[]; kind: 'set'; value: import('./json.types').JsonValue } | { path: string[]; kind: 'remove' };

export type WriteContentTarget =
  | { kind: 'csv'; table: import('./project-identity.types').CsvTableKey }
  | { kind: 'spec'; target: import('./project-identity.types').EntityEditTarget }
  | { kind: 'text'; path: string }
  | { kind: 'json'; origin: import('./document-identity.types').JsonDocumentOrigin }
  | { kind: 'joint'; root: import('./joint-target.types').JointEditRoot }
  | { kind: 'recovery'; origin: import('./document-identity.types').JsonDocumentOrigin };
export interface WriteContent<T> {
  target: WriteContentTarget;
  value: T;
}

export interface WriteResult<T = RowData> {
  requestId?: string;
  sessionUpdates: CommittedSessionUpdate[];
  identityChanges: import('@/shared/types/project-identity.types').EntityIdentityChange[];
  changes: FileChangeRecord[];
  invalidation: ProjectInvalidation;
  keyMap: CsvRowKeyMapping[];
  content: WriteContent<T> | null;

  baseVersions: FileVersion[];
  history: FileHistorySnapshot;
}

export interface CommittedSessionUpdate {
  sessionId: string;
  modRoot: string;
  projection: ProjectSessionInvalidationResult;
}

export interface CommittedWriteEvent {
  originWindowLabel: string;
  modRoot: string;
  sessionId: string | null;
  reason: 'save' | 'undo' | 'redo' | 'refresh';
  result: WriteResult<unknown>;
}

export type SaveDelivery =
  | { kind: 'references'; snapshot: import('./project-identity.types').ReferenceSources; event: CommittedWriteEvent | null }
  | { kind: 'missing'; requestId: string; paths: string[] }
  | { kind: 'saved'; requestId: string; event: CommittedWriteEvent }
  | { kind: 'blocked'; requestId: string; modRoot: string; sessionId: string | null; diagnostic: import('./error.types').ErrorDiagnostic }
  | { kind: 'waiting'; modRoot: string; waiting: boolean };
