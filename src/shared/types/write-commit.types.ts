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

export interface WriteResult<T = RowData> {
  sessionUpdates: CommittedSessionUpdate[];
  identityChanges: import('@/shared/types/project-identity.types').EntityIdentityChange[];
  changes: FileChangeRecord[];
  invalidation: ProjectInvalidation;
  keyMap: CsvRowKeyMapping[];
  refreshedEntity: T | null;
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
