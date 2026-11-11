export type JavaManagementAction =
  { kind: 'refresh' | 'download' | 'stop' | 'remove' } | { kind: 'import'; archive: string } | { kind: 'probe' | 'test'; javaPath: string };

export interface JavaEnvironment {
  path: string;
  version: string;
  milliseconds: number;
  released: boolean;
  logPath: string | null;
}

export interface JavaLocation {
  file: string;
  version: number;
  range: { start: number; end: number };
}
export interface JavaDocumentEdit {
  file: string;
  previousFile?: string;
  version: number;
  source: string | null;
  edits: { from: number; to: number; text: string }[];
}
export type JavaQueryPurpose = 'document' | 'hover' | 'declaration' | 'references' | 'source';
export interface JavaInspection {
  purpose: JavaQueryPurpose;
  project: string;
  revision: number;
  file: string;
  version: number;
  source: string | null;
  origin: string | null;
  binding: { name: string; owner: string | null; type: string | null; parameters: string[] | null; binary: boolean | null } | null;
  diagnostics: { file: string; version: number; start: number; end: number; line: number; message: string; severity: string }[];
  outline: { name: string; kind: string; depth: number; range: { start: number; end: number } }[];
  locations: JavaLocation[];
}
export type JavaAssistPurpose = 'complete' | 'signature' | 'imports' | 'rename' | 'validate';
export interface JavaSourceEdit {
  file: string;
  version: number;
  source: string;
  target: string | null;
  edits: { from: number; to: number; text: string }[];
}
export interface JavaAssistance {
  assistance: true;
  purpose: JavaAssistPurpose;
  project: string;
  revision: number;
  file: string;
  version: number;
  argument: number;
  candidates: { label: string; text: string; detail: string; from: number; to: number; relevance: number }[];
  files: JavaSourceEdit[];
  choices: { name: string; candidates: string[] }[];
  conflicts: string[];
}

export interface JavaManagementSnapshot {
  revision: number;
  operationKey: string | null;
  queued: number;
  action: JavaManagementAction | null;
  active: boolean;
  phase: string;
  installation: 'unchecked' | 'missing' | 'installed' | 'damaged';
  jdtVersion: string;
  downloadBytes: number;
  installationPath: string;
  logPath: string;
  stagedBytes: number;
  instances: number;
  projects: number;
  progress: { phase: string; completedBytes: number; totalBytes: number; filesDone: number; filesTotal: number } | null;
  environment: JavaEnvironment | null;
  error: string | null;
}
