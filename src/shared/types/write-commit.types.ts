import type { FileVersion, EntityIdentityChange } from '@/shared/types/project-identity.types';
import type { FileChangeRecord } from '@/shared/types/file-changes.types';
import type { RowData } from '@/shared/types/json.types';
import type { ProjectInvalidation, ProjectSessionInvalidationResult } from '@/shared/types/project-session.types';
import type { FileHistorySnapshot } from '@/shared/types/file-history.types';
import type { JsonValue } from './json.types';
import type { CsvTableKey, EntityEditTarget, ReferenceSources } from './project-identity.types';
import type { JsonDocumentOrigin } from './document-identity.types';
import type { JointEditRoot } from './joint-target.types';
import type { ErrorDiagnostic } from './error.types';

export interface CsvRowKeyMapping {
  previousKey: string;
  nextKey: string;
  rowIndex: number;
}

export type SaveAcceptanceTask = () => void | boolean | SaveAcceptanceTask[] | Promise<void | boolean | SaveAcceptanceTask[]>;

export type SaveEdit = { path: string[]; kind: 'set'; value: JsonValue } | { path: string[]; kind: 'remove' };

export type WriteContentTarget =
  | { kind: 'csv'; table: CsvTableKey }
  | { kind: 'spec'; target: EntityEditTarget }
  | { kind: 'text'; path: string }
  | { kind: 'json'; origin: JsonDocumentOrigin }
  | { kind: 'joint'; root: JointEditRoot }
  | { kind: 'recovery'; origin: JsonDocumentOrigin };
export interface WriteContent<T> {
  target: WriteContentTarget;
  value: T;
}

export interface WriteResult<T = RowData> {
  requestId?: string;
  sessionUpdates: CommittedSessionUpdate[];
  identityChanges: EntityIdentityChange[];
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
  | { kind: 'references'; snapshot: ReferenceSources; event: CommittedWriteEvent | null }
  | { kind: 'missing'; requestId: string; paths: string[] }
  | { kind: 'saved'; requestId: string; event: CommittedWriteEvent }
  | { kind: 'blocked'; requestId: string; modRoot: string; sessionId: string | null; diagnostic: ErrorDiagnostic }
  | { kind: 'waiting'; modRoot: string; waiting: boolean };
