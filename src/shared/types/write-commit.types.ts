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

export type WriteContentTarget =
  | { kind: 'spec'; target: import('./project-identity.types').EntityEditTarget }
  | { kind: 'text'; path: string }
  | { kind: 'json'; origin: import('./project-identity.types').JsonDocumentOrigin }
  | { kind: 'joint'; root: import('./project-identity.types').JointEditRoot }
  | { kind: 'recovery'; origin: import('./project-identity.types').JsonDocumentOrigin };
export interface WriteContent<T> {
  target: WriteContentTarget;
  value: T;
}

export interface WriteResult<T = RowData> {
  sessionUpdates: CommittedSessionUpdate[];
  identityChanges: import('@/shared/types/project-identity.types').EntityIdentityChange[];
  changes: FileChangeRecord[];
  invalidation: ProjectInvalidation;
  keyMap: CsvRowKeyMapping[];
  content: WriteContent<T> | null;
  commitId: number;
  baseVersions: FileVersion[];
  history: FileHistorySnapshot;
}

export type CommittedProjection =
  | { status: 'ready'; projection: ProjectSessionInvalidationResult }
  | { status: 'pending'; error: import('@/shared/types/error.types').ErrorDiagnostic };

export type CommittedSessionUpdate = { sessionId: string; modRoot: string; commitId: number } & CommittedProjection;

export interface CommittedWriteEvent {
  originWindowLabel: string;
  modRoot: string;
  sessionId: string | null;
  reason: 'save' | 'undo' | 'redo';
  result: WriteResult<unknown>;
}

export type ProjectChange =
  | { kind: 'commit'; projection: ProjectSessionInvalidationResult; event: CommittedWriteEvent }
  | { kind: 'refresh'; projection: ProjectSessionInvalidationResult }
  | { kind: 'closed'; sessionId: string };

export interface JsonSourceConfirmation {
  path: string;
  sourceFingerprint: string;
}

export interface JsonWriteOptions {
  preserveOriginalJson?: boolean;
  confirmedSources?: JsonSourceConfirmation[];
}

export interface SynchronizeCommittedWritePayload {
  sessionId: string;
  modRoot: string;
  commitId: number;
}
