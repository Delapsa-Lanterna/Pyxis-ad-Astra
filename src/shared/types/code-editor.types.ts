import type { TextFileOpen } from './text-file-editing.types';

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

export interface CodeEditorOpen {
  sessionId: string;
  modRoot: string;
  files: TextFileOpen[];
}
export interface CodeEditorDelivery {
  key: string;
  files: TextFileOpen[];
}
