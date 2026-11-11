import type { ErrorDiagnostic } from './error.types';

export interface CodeEditorSource {
  sessionId: string;
  modRoot: string;
  label: string;
  directory: string | null;
  readOnly: boolean;
}
export interface CodeEditorSources {
  revision: number;
  sources: CodeEditorSource[];
  analysisRoots: string[];
}

export interface CodeEditorFile {
  path: string;
  line?: number;
  column?: number;
}
export interface CodeEditorOpen {
  sessionId: string;
  modRoot: string;
  files: CodeEditorFile[];
}
export interface CodeEditorDelivery {
  key: string;
  files: CodeEditorFile[];
}
export interface CodeEditorFileResult {
  path: string;
  diagnostic: ErrorDiagnostic | null;
}
