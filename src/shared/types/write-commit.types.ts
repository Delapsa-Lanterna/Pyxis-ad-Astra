import type { CsvTableKey, EntityEditTarget, EntityIdentityChange, FileVersion } from './project-identity.types';
import type { CommittedFileChange } from './file-changes.types';
import type { FileHistorySnapshot } from './file-history.types';
import type { ProjectInvalidation, SessionContentUpdate } from './project-session.types';
import type { JsonDocumentOrigin } from './document-identity.types';
import type { JointEditRoot } from './joint-target.types';
import type { DocumentEdit } from './file-content.types';
import type { RowData } from './json.types';
import type { JavaProjectChange } from './java-project.types';

export type SaveEdit = DocumentEdit;
export type SaveAcceptanceTask = () => void | boolean | SaveAcceptanceTask[] | Promise<void | boolean | SaveAcceptanceTask[]>;
export interface CsvRowKeyMapping {
  previousKey: string;
  nextKey: string;
  rowIndex: number;
}
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
  javaProjectChange?: JavaProjectChange;
  requestId?: string;
  sessionUpdates: CommittedSessionUpdate[];
  identityChanges: EntityIdentityChange[];
  changes: CommittedFileChange[];
  invalidation: ProjectInvalidation;
  keyMap: CsvRowKeyMapping[];
  content: WriteContent<T> | null;
  baseVersions: FileVersion[];
  history: FileHistorySnapshot;
}
export interface CommittedSessionUpdate {
  sessionId: string;
  modRoot: string;
  content: SessionContentUpdate;
}
export interface CommittedWriteEvent {
  originWindowLabel: string;
  modRoot: string;
  sessionId: string | null;
  reason: 'save' | 'undo' | 'redo' | 'refresh';
  result: WriteResult<unknown>;
}
