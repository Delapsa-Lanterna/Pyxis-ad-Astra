import type {
  TableKey,
  ProjectSessionId,
  EntityKind,
  ResourceSource,
  ResourceOwnerKind,
  ResourceRef,
} from '@/shared/types/project-identity.types';
import type { JsonValue, RowData } from '@/shared/types/json.types';
import type { ErrorDiagnostic } from '@/shared/types/error.types';

export interface DiscoveredField {
  key: string;
  type: DiscoveredFieldType;
  origin: ResourceSource;
}

export type DiscoveredFieldType =
  'boolean' | 'integer' | 'float' | 'string' | 'path-image' | 'string-array' | 'color-rgba' | 'array-of-object' | 'tag-select' | 'object';

export interface ProjectManifest {
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  sessionId: ProjectSessionId;
  modRoot: string;
  starsectorRoot: string | null;
  coreAvailable: boolean;
  associatedSpecTables: TableKey[];
  /** Null models a Mod without `mod_info.json` (matches backend Option<Value>). */
  modInfo: RowData | null;
  tableSummaries: Record<TableKey, TableSummary>;
  tableEntitySummaries: Record<TableKey, number>;
  entitySummaries: EntitySummaries;
  warnings: GameScanWarning[];
}

export interface ProjectInvalidation {
  paths: string[];
  tables: TableKey[];
  entities: InvalidatedEntityRef[];
  resources: InvalidatedResourceScope[];
  queryScopes: InvalidatedQueryScope[];
  session: boolean;
}

export interface ProjectSessionInvalidationResult {
  projectionRevision: number;
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
  table: TableKey | null;
  source: string | null;
  entity: InvalidatedEntityRef | null;
  resource: InvalidatedResourceScope | null;
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

export interface SourceOptionGroup {
  origin: ResourceSource;
  options: SourceOption[];
}

export interface SourceOption {
  label: string;
  value: string;
  description: string | null;
  resourceRef: ResourceRef | null;
  origin: ResourceSource;
}

export interface EntityData {
  target: import('@/shared/types/project-identity.types').EntityEditTarget;
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  kind: EntityKind;
  id: string;
  data: JsonValue;
  resourceRefs: Record<string, ResourceRef>;
}

export interface ResourceDataUrlBatchEntry {
  key: string;
  source: ResourceSource;
  relPath: string;
  ownerKind: ResourceOwnerKind;
  ownerId: string;
  dataUrl: string | null;
}

export interface ResourceDataUrlBatchResult {
  entries: ResourceDataUrlBatchEntry[];
}

export interface HullReferenceOption {
  label: string;
  value: string;
  origin: ResourceSource;
  kind: HullReferenceKind;
  resourceRef: ResourceRef | null;
}

export type HullReferenceKind = 'ship' | 'skin';

export interface HullReferenceGroup {
  origin: ResourceSource;
  kind: HullReferenceKind;
  options: HullReferenceOption[];
}

export interface HullReferencesResult {
  groups: HullReferenceGroup[];
  hullNames: Record<string, string>;
  sprites: Record<string, ResourceRef>;
  builtInWeaponSlots: Record<string, { id: string; origin: ResourceSource }[]>;
}

export interface GameScanWarning extends ErrorDiagnostic {
  path: string;
  editTarget: GameWarningEditTarget | null;
}

export interface GameWarningEditTarget {
  modRoot: string;
  path: string;
}

export interface GameModSummary {
  modRoot: string;
  id: string;
  name: string;
  version: string;
  description: string;
  hasModInfo: boolean;
}

export interface GameOverviewData {
  starsectorRoot: string;
  coreAvailable: boolean;
  modsDir: string;
  mods: GameModSummary[];
  warnings: GameScanWarning[];
}

export type OpenDirectoryKind = 'game-root' | 'mod-in-game' | 'external-mod' | 'unknown';

export interface OpenDirectoryResult {
  kind: OpenDirectoryKind;
  selectedPath: string;
  starsectorRoot: string | null;
  modRoot: string | null;
  overview: GameOverviewData | null;
  warnings: GameScanWarning[];
}
