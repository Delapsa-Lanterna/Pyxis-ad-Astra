import type { EntityTargetSnapshot, FileVersion } from './project-identity.types';
import type { ErrorDiagnostic } from './error.types';

export interface TextFileEdits {
  files: { file: string; source: string; target: string | null; edits: { from: number; to: number; text: string }[] }[];
}

export interface TextFileOpen {
  path: string;
  line?: number;
  column?: number;
}
export interface TextFileOpenResult {
  path: string;
  diagnostic: ErrorDiagnostic | null;
}

export interface TextFileData {
  entity: EntityTargetSnapshot | null;
  path: string;
  text: string;
  baseVersions: FileVersion[];
}

export interface TextSave {
  baseVersions: FileVersion[];
  sessionId: string | null;
  modRoot: string;
  path: string;
  text: string;
}
export interface TextBatchSave {
  sessionId: string;
  modRoot: string;
  baseVersions: FileVersion[];
  files: { path: string; target: string | null; text: string }[];
}

export interface LoadTextFilePayload {
  sessionId: string | null;
  modRoot: string;
  path: string;
}
