import type { JsonValue, RowData } from '@/shared/types/json.types';
import type { WriteResult } from '@/shared/types/write-commit.types';
import type { CsvRow } from '@/shared/types/tables.types';
import type { FileVersion } from '@/shared/types/project-identity.types';
import type { JsonWriteOptions } from '@/shared/types/json-write.types';

export interface SavedConfig<T> {
  entity: T;
  receipt: WriteResult;
}

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
  entityData: JsonValue;
}

export interface IndexedConfigEntityData extends Omit<IndexedConfigEntityRefresh, 'entityData'> {
  baseVersions: FileVersion[];
  entityData: RowData | null;
}

export interface ModInfoSave {
  baseVersions: FileVersion[];
  sessionId: string;
  modRoot: string;
  data: RowData;
  jsonWrite?: JsonWriteOptions;
  orderedJson?: string | null;
}

export interface IndexedConfigSave {
  baseVersions: FileVersion[];
  sessionId: string;
  modRoot: string;
  kind: IndexedConfigKind;
  previousId: string | null;
  nextId: string;
  indexRow: RowData;
  entityData: RowData;
  jsonWrite?: JsonWriteOptions;
  orderedJson?: string | null;
}

export interface IndexedConfigDelete {
  baseVersions: FileVersion[];
  sessionId: string;
  modRoot: string;
  kind: IndexedConfigKind;
  id: string;
  deleteTarget: boolean;
}
