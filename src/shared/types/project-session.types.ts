import type { CsvTableKey, ProjectSessionId, EntityKind, ResourceSource, FileVersion } from '@/shared/types/project-identity.types';
import type { RowData } from '@/shared/types/json.types';
import type { GameScanWarning } from '@/shared/types/directory-opening.types';
import type { FileChangeRecord } from '@/shared/types/file-changes.types';

export interface ProjectManifest {
  baseVersions: FileVersion[];
  sessionId: ProjectSessionId;
  modRoot: string;
  starsectorRoot: string | null;
  coreAvailable: boolean;
  associatedSpecTables: CsvTableKey[];
  /** Null models a Mod without `mod_info.json` (matches backend Option<Value>). */
  modInfo: RowData | null;
  tableSummaries: Record<CsvTableKey, TableSummary>;
  tableEntitySummaries: Record<CsvTableKey, number>;
  entitySummaries: EntitySummaries;
  warnings: GameScanWarning[];
}

export interface ProjectInvalidation {
  paths: string[];
  tables: CsvTableKey[];
  entities: InvalidatedEntityRef[];
  resources: InvalidatedResourceScope[];
  queryScopes: InvalidatedQueryScope[];
  session: boolean;
}

export interface ProjectSessionInvalidationResult {
  manifest: ProjectManifest;
  invalidation: ProjectInvalidation;
}

export interface InvalidatedEntityRef {
  kind: EntityKind;
  id: string | null;
}

export interface InvalidatedResourceScope {
  source: ResourceSource;
  relPath: string;
}

export interface InvalidatedQueryScope {
  kind: InvalidatedQueryKind;
  table: CsvTableKey | null;
  source: string | null;
  entity: InvalidatedEntityRef | null;
  resource: InvalidatedResourceScope | null;
}

export type InvalidatedQueryKind =
  | 'csv-table-window'
  | 'csv-source-options'
  | 'csv-row-preview'
  | 'hull-references'
  | 'entity-detail'
  | 'entity-list'
  | 'resource-data-urls';

export interface TableSummary {
  path: string;
  header: string[];
  available: boolean;
  totalRows: number | null;
}

export interface EntitySummaries {
  factions: number;
  missions: number;
  ships: number;
  weapons: number;
  projectiles: number;
  variants: number;
  skins: number;
  systems: number;
  skills: number;
}

export interface OpenProjectSessionPayload {
  modRoot: string;
  starsectorRoot: string | null;
}

export interface CloseProjectSessionPayload {
  sessionId: string;
}

export interface InvalidateProjectSessionPayload {
  sessionId: string;
  changes: FileChangeRecord[];
}

export interface SourceRefresh {
  sessionId: string;
  sources: readonly InvalidatedResourceScope[];
}
