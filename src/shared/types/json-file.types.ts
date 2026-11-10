import type { EntityEditTarget, FileVersion } from './project-identity.types';
import type { JsonFileContent, JsonFileWrite } from './file-content.types';
import type { JsonWriteOptions } from './json-write.types';
import type { JsonValue, RowData } from './json.types';

export interface JsonDocumentRead {
  sessionId: string;
  relPath: string;
}
export interface JsonDocumentFile {
  document: JsonFileContent;
  baseVersions: FileVersion[];
}

export interface JsonFileSave {
  sessionId: string;
  modRoot: string;
  baseVersions: FileVersion[];
  previousId: string | null;
  nextId: string;
  relPath: string | null;
  document: JsonFileWrite;
  jsonWrite: JsonWriteOptions;
}
export interface JsonFileDelete {
  sessionId: string;
  modRoot: string;
  baseVersions: FileVersion[];
  entityId: string;
  relPath: string;
}
export interface JsonEntityFile {
  target: EntityEditTarget;
  id: string;
  baseVersions: FileVersion[];
  path: string;
  relPath: string;
  data: RowData;
  document: JsonFileContent;
}
export interface VariantFile {
  variantId: string;
  hullId: string;
  path: string;
  relPath: string;
  data: JsonValue;
  document: JsonFileContent | null;
  weaponGroupCount: number;
  hullModCount: number;
  permaModCount: number;
  wingCount: number;
}
export interface SkinFile {
  skinHullId: string;
  baseHullId: string;
  path: string;
  relPath: string;
  data: JsonValue;
  document: JsonFileContent | null;
  builtInModCount: number;
  builtInWeaponCount: number;
  builtInWingCount: number;
  weaponSlotChangeCount: number;
  engineSlotChangeCount: number;
}
