import type { FileChangeReplayDirection } from '@/shared/types/file-changes.types';
export interface FileHistoryEntrySummary {
  id: number;
  timestamp: number;
  paths: string[];
  label: string;
}

export interface FileHistorySnapshot {
  revision: number;
  undoStack: FileHistoryEntrySummary[];
  redoStack: FileHistoryEntrySummary[];
}

export interface FileReplay {
  sessionId: string;
  modRoot: string;
  direction: FileChangeReplayDirection;
  entryId: number;
  revision: number;
}

export interface FileHistoryPayload {
  sessionId: string;
  modRoot: string;
}
