import type { CsvTableKey } from '@/shared/types/project-identity.types';
import type { CsvDirtyRow, CsvSearchField, CsvTableRows, CsvCellTarget } from '@/shared/types/tables.types';

/** Metadata for one imported Mod in the workspace */
export interface ModEntry {
  modRoot: string;
  displayName: string;
  version: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
}

export interface ModOpeningFailureFile {
  path: string;
  line?: number;
  column?: number;
}

export interface ModOpeningFailure {
  modRoot: string;
  message: string;
  diagnostic: import('@/shared/types/error.types').ErrorDiagnostic;
  file: ModOpeningFailureFile | null;
}

/** Per-Mod table state — fully isolated from other Mods */
export interface ModTableState {
  rowOrders: Partial<Record<CsvTableKey, import('./table-save.types').CsvRowOrderEntry[]>>;
  baseVersions: Record<CsvTableKey, import('@/shared/types/project-identity.types').FileVersion[]>;
  tables: Record<CsvTableKey, CsvTableRows>;
  originalTables: Record<CsvTableKey, CsvTableRows>;
  headers: Record<CsvTableKey, string[]>;
  totalRows: Record<CsvTableKey, number>;
  filteredRows: Record<CsvTableKey, number>;
  dirty: Record<CsvTableKey, Record<string, CsvDirtyRow>>;
  pendingExternalTableUpdates: Record<CsvTableKey, boolean>;
  currentTab: CsvTableKey;
  searchField: CsvSearchField;
  searchText: string;
  selectedRowKey: string | null;
  editing: CsvCellTarget | null;
  nextRowKey: number; // Per-mod row key counter to prevent collisions
}

/** Which main-content view is shown */
export type WorkspaceView = 'overview' | 'table' | 'settings' | 'config' | 'about' | 'mod-files';

/** Which config sub-view is shown when currentView === 'config' */
export type ConfigView = 'mod-overview' | 'file-history' | 'mod-info' | 'factions' | 'skins' | 'variants' | 'mission';
