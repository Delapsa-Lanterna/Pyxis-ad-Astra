import type { ProjectInvalidation, ProjectManifest, RowData } from '@/shared/types';
import type { WriteResult } from '@/shared/types';
import type { SpecEditorKind } from '@/shared/types';

export const WINDOW_EVENTS = {
  editTargetPrepare: 'edit-target-prepare',
  editTargetPrepared: 'edit-target-prepared',
  editTargetRelease: 'edit-target-release',
  committedWriteApplied: 'committed-write-applied',
  windowCloseIntent: 'window-lifecycle-close-requested',
  managedWindowReleased: 'managed-window-released',
  managedWindowRequestAvailable: 'managed-window-request-available',
  appSettingsChanged: 'app-settings-changed',
  projectSourcesRefreshed: 'project-sources-refreshed',
} as const;

export interface EditorSpecSavedEvent {
  kind: SpecEditorKind;
  sessionId: string;
  modRoot: string;
  id: string;
  spec: RowData;
  writeResult: WriteResult<unknown>;
}

export interface FileEditorSavedEvent {
  modRoot: string;
  path: string;
  sessionId: string | null;
  writeResult: WriteResult<unknown>;
}

export interface FileEditorTextAppliedEvent {
  commitId: number;
  baseVersions: import('@/shared/types').FileVersion[];
  modRoot: string;
  path: string;
  sessionId: string;
  text: string;
}

export interface ProjectSessionInvalidatedEvent {
  projectionRevision: number;
  manifest: ProjectManifest;
  invalidation: ProjectInvalidation;
}

export type { CommittedWriteEvent } from '@/shared/types';

export type AppSettingsChangedEvent = import('@/shared/types').SettingsSnapshot;

export interface EntityIdentityAppliedEvent {
  sessionId: string;
  modRoot: string;
  result: WriteResult<unknown>;
}
