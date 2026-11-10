import type { ErrorDiagnostic } from './error.types';
import type { FileVersion } from './project-identity.types';
import type { JsonWriteOptions } from './json-write.types';
import type { MiscConfigKind } from './document-identity.types';
import type { JsonComposition } from './json-composition.types';
import type { JsonFileContent, JsonFileWrite } from './file-content.types';
import type { JsonValue } from './json.types';
export type { MiscConfigKind } from './document-identity.types';

export interface MiscConfigScope {
  sessionId: string;
  modRoot: string;
}
export interface MiscConfigRead extends MiscConfigScope {
  kind: MiscConfigKind;
}
export interface MiscConfigEntry {
  kind: MiscConfigKind;
  path: string;
  relPath: string;
  state: 'present' | 'missing' | 'error';
  error: ErrorDiagnostic | null;
}
export interface MiscConfigFile {
  kind: MiscConfigKind;
  path: string;
  relPath: string;
  baseVersions: FileVersion[];
  document: JsonFileContent;
  data: JsonValue;
  composition: JsonComposition;
}
export interface MiscConfigWrite extends MiscConfigScope {
  kind: MiscConfigKind;
  baseVersions: FileVersion[];
  document: JsonFileWrite;
  jsonWrite: JsonWriteOptions;
}
export interface MiscConfigDelete extends MiscConfigScope {
  kind: MiscConfigKind;
  baseVersions: FileVersion[];
}
