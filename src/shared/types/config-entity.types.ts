import type { RowData } from './json.types';
import type { CsvRow } from './tables.types';
import type { FileVersion } from './project-identity.types';
import type { JsonWriteOptions } from './json-write.types';
import type { JsonFileContent, JsonFileWrite } from './file-content.types';

export interface ConfigEditTarget {
  sessionId: string;
  modRoot: string;
  kind: 'variant' | 'skin' | 'faction' | 'mission';
  id: string;
  relPath: string | null;
}
export type IndexedConfigKind = 'faction' | 'mission';
export interface IndexedConfigEntityRefresh {
  entityId: string;
  indexPath: string;
  indexHeader: string[];
  indexRows: CsvRow[];
  entityData: RowData | null;
  document: JsonFileContent | null;
}
export interface ModInfoSave {
  sessionId: string;
  modRoot: string;
  baseVersions: FileVersion[];
  document: JsonFileWrite;
  jsonWrite: JsonWriteOptions;
}
interface IndexedConfigSaveScope {
  sessionId: string;
  modRoot: string;
  baseVersions: FileVersion[];
  previousId: string | null;
  nextId: string;
  indexRow: RowData;
  jsonWrite: JsonWriteOptions;
}
export type IndexedConfigSave = IndexedConfigSaveScope &
  ({ kind: 'faction'; document: JsonFileWrite } | { kind: 'mission'; document: JsonFileWrite; text: string });
export interface IndexedConfigDelete {
  sessionId: string;
  modRoot: string;
  baseVersions: FileVersion[];
  kind: IndexedConfigKind;
  id: string;
  deleteTarget: boolean;
}
