import type { FileVersion } from './project-identity.types';
import type { ErrorDiagnostic, ErrorLocation } from './error.types';
export interface GradleTask {
  path: string;
  group: string | null;
  description: string | null;
}
export interface JavaArtifact {
  id: string;
  path: string;
  bytes: number;
  fingerprint: string;
}
export interface JavaBuildResult {
  mode: 'manual' | 'gradle';
  id: string;
  task: string;
  artifacts: JavaArtifact[];
  inputsChanged: boolean;
  milliseconds: number;
}
export interface JavaDeploy {
  sessionId: string;
  modRoot: string;
  artifact: string;
  target: string;
  baseVersions: FileVersion[];
}
export interface JavaDeployPreview {
  source: JavaArtifact;
  request: JavaDeploy;
  targetBytes: number;
  exists: boolean;
}
export interface JavaProjectSettings {
  buildMode: 'manual' | 'gradle';
  sources: string[] | null;
  libraries: string[];
  primaryJar: string | null;
  gradle: string | null;
  project: string | null;
}
export interface JavaProjectSnapshot {
  revision: number;
  modRoot: string;
  version: string;
  mode: 'core' | 'manual' | 'gradle';
  settings: JavaProjectSettings;
  sources: string[];
  libraries: string[];
  gameJars: string[];
  artifacts: string[];
  tasks: GradleTask[];
  choices: string[];
  selectedProject: string | null;
  sourceCount: number;
  missing: string[];
  javaPath: string | null;
  gradle: { path: string; source: 'wrapper' | 'selected' | 'system' } | null;
  gradleError: ErrorDiagnostic | null;
  target: string;
  buildFiles: string[];
  stale: boolean;
  configuration: string;
  configurationError: ErrorDiagnostic | null;
  primaryJar: string | null;
  deployTargets: string[];
  active: boolean;
  phase: 'idle' | 'running' | 'succeeded' | 'cancelled' | 'failed' | 'offlineFailed';
  operation: JavaProjectOperation | null;
  taskId: string | null;
  taskMode: 'manual' | 'gradle';
  task: string;
  exitCode: number | null;
  output: string;
  locations: ErrorLocation[];
  logPath: string | null;
  error: ErrorDiagnostic | null;
  milliseconds: number;
  build: JavaBuildResult | null;
}
export type JavaProjectOperation =
  { kind: 'sync'; online: boolean } | { kind: 'detect' } | { kind: 'build'; tasks: string[]; arguments: string[]; online: boolean };
export type JavaProjectAction =
  | { kind: 'read' | 'refresh' | 'detect' | 'cancel' }
  | { kind: 'save'; settings: JavaProjectSettings }
  | { kind: 'sync'; online: boolean }
  | { kind: 'build'; tasks: string[]; arguments: string[]; online: boolean; configuration: string }
  | { kind: 'locate'; artifact: string };
