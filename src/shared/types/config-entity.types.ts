import type { JsonValue, RowData } from '@/shared/types/json.types';

export interface SavedConfig<T> {
  entity: T;
  receipt: import('@/shared/types/write-commit.types').WriteResult;
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
  indexRows: import('@/shared/types/tables.types').CsvRow[];
  entityData: JsonValue;
}

export interface IndexedConfigEntityData extends Omit<IndexedConfigEntityRefresh, 'entityData'> {
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  entityData: RowData | null;
}

export interface ModInfoSave {
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  sessionId: string;
  modRoot: string;
  data: RowData;
  jsonWrite?: import('@/shared/types/write-commit.types').JsonWriteOptions;
  orderedJson?: string | null;
}

export interface IndexedConfigSave {
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  sessionId: string;
  modRoot: string;
  kind: IndexedConfigKind;
  previousId: string | null;
  nextId: string;
  indexRow: RowData;
  entityData: RowData;
  jsonWrite?: import('@/shared/types/write-commit.types').JsonWriteOptions;
  orderedJson?: string | null;
}

export interface IndexedConfigDelete {
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  sessionId: string;
  modRoot: string;
  kind: IndexedConfigKind;
  id: string;
  deleteTarget: boolean;
}
