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
  direction: import('@/shared/types/file-changes.types').FileChangeReplayDirection;
  entryId: number;
  revision: number;
}

export interface FileHistoryPayload {
  sessionId: string;
  modRoot: string;
}
