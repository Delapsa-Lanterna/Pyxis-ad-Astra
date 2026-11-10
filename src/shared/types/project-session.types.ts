import type { CsvTableKey, EntityKind, FileVersion, ProjectSessionId, ResourceSource } from './project-identity.types';
import type { GameScanWarning } from './directory-opening.types';
import type { FileChangeRecord } from './file-changes.types';
import type { RowData } from './json.types';

export interface ProjectManifest {
  sessionId: ProjectSessionId;
  modRoot: string;
  starsectorRoot: string | null;
  baseVersions: FileVersion[];
  coreAvailable: boolean;
  associatedSpecTables: CsvTableKey[];
  modInfo: RowData | null;
  tableSummaries: Record<CsvTableKey, TableSummary>;
  tableEntitySummaries: Record<CsvTableKey, number>;
  entitySummaries: EntitySummaries;
  warnings: GameScanWarning[];
}
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
export interface ProjectInvalidation {
  renames?: [string, string][];
  paths: string[];
  tables: CsvTableKey[];
  entities: InvalidatedEntityRef[];
  resources: InvalidatedResourceScope[];
  queryScopes: InvalidatedQueryScope[];
  session: boolean;
}
export interface SessionContentUpdate {
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
export type InvalidatedQueryKind =
  | 'csv-table-window'
  | 'csv-source-options'
  | 'csv-row-preview'
  | 'hull-references'
  | 'entity-detail'
  | 'entity-list'
  | 'resource-data-urls';
export interface InvalidatedQueryScope {
  kind: InvalidatedQueryKind;
  table: CsvTableKey | null;
  source: string | null;
  entity: InvalidatedEntityRef | null;
  resource: InvalidatedResourceScope | null;
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
