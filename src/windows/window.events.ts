import type { ProjectInvalidation, ProjectManifest, RowData } from '@/shared/types';
import type { WriteResult } from '@/shared/types';
import type { AppSettings } from '@/shared/types';
import type { EditorSpecKind } from '@/shared/types';

export const WINDOW_EVENTS = {
  editTargetPrepare: 'edit-target-prepare',
  editTargetPrepared: 'edit-target-prepared',
  editTargetRelease: 'edit-target-release',
  committedWriteApplied: 'committed-write-applied',
  windowCloseIntent: 'window-lifecycle-close-requested',
  managedWindowReleased: 'managed-window-released',
  editorPreviewDraftUpdated: 'editor-preview-draft-updated',
  fileEditorFocusLine: 'file-editor-focus-line',
  appSettingsChanged: 'app-settings-changed',
} as const;

export interface EditorPreviewDraftUpdatedEvent {
  sessionId: string;
  modRoot: string;
  id: string;
  draft: RowData;
}

export interface EditorSpecSavedEvent {
  kind: EditorSpecKind;
  sessionId: string;
  modRoot: string;
  id: string;
  spec: RowData;
  writeResult: WriteResult<unknown>;
}

export type FileEditorContextSeverity = 'error' | 'warning' | 'info';

export interface FileEditorFocusLineEvent {
  column: number | null;
  contextLabel: string | null;
  contextSeverity: FileEditorContextSeverity | null;
  line: number | null;
  message: string | null;
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

export type AppSettingsChangedEvent = AppSettings;

export interface EntityIdentityAppliedEvent {
  sessionId: string;
  modRoot: string;
  result: WriteResult<unknown>;
}
