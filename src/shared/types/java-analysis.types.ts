export type JavaManagementAction =
  { kind: 'refresh' | 'download' | 'stop' | 'remove' } | { kind: 'import'; archive: string } | { kind: 'probe' | 'test'; javaPath: string };

export interface JavaEnvironment {
  path: string;
  version: string;
  milliseconds: number;
  released: boolean;
  logPath: string | null;
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
