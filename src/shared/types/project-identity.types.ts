export type ProjectSessionId = string;

export type EntityKind = 'ship' | 'weapon' | 'projectile' | 'system' | 'skill' | 'faction' | 'mission' | 'variant' | 'skin';

export const RESOURCE_SOURCES = ['mod', 'reference', 'core'] as const;

export type ResourceSource = (typeof RESOURCE_SOURCES)[number];

export const RESOURCE_OWNER_KINDS = [
  'ship',
  'weapon',
  'variant',
  'skin',
  'faction',
  'mission',
  'hullmods',
  'shipSystems',
  'industries',
  'skills',
  'abilities',
  'commodities',
  'specialItems',
  'submarkets',
  'marketConditions',
] as const;

export type ResourceOwnerKind = (typeof RESOURCE_OWNER_KINDS)[number];

export interface ResourceRef {
  readonly reference?: ReferenceSource;
  readonly source: ResourceSource;
  readonly relPath: string;
  readonly ownerKind: ResourceOwnerKind;
  readonly ownerId: string;
  readonly key: string;
}

export interface ReferenceSource {
  sessionId: string;
  modRoot: string;
}
export interface ReferenceSources {
  revision: number;
  sources: ReferenceSource[];
}

export const TABLE_KEYS = [
  'ships',
  'weapons',
  'wings',
  'hullmods',
  'shipSystems',
  'industries',
  'skills',
  'abilities',
  'commodities',
  'specialItems',
  'submarkets',
  'marketConditions',
  'simOpponents',
  'descriptions',
] as const;

export type CsvTableKey = (typeof TABLE_KEYS)[number];

export interface FileVersion {
  path: string;
  fingerprint?: string | null;
}

export interface EntityFileLocation {
  reference?: ReferenceSource;
  source: ResourceSource;
  root: string;
  relPath: string;
  path: string;
}

export type EntityLinkedRecord = { kind: 'csv'; table: CsvTableKey; rowKey: string } | { kind: 'index'; path: string; rowIndex: number };

export type EntityTargetState = 'existing' | 'create';

export interface EntityEditTarget {
  kind: EntityKind;
  id: string;
  source: EntityFileLocation | null;
  write: EntityFileLocation;
  state: EntityTargetState;
  linkedRecord: EntityLinkedRecord | null;
}

export interface EntityEditInfo {
  target: EntityEditTarget;
  baseVersions: FileVersion[];
}

export interface EntityIdentityIntent {
  source: EntityEditTarget;
  nextId: string;
  nextWrite: EntityFileLocation;
  destinationVersion: FileVersion;
}

export interface EntityIdentityChange {
  before: EntityEditTarget;
  after: EntityEditTarget;
}

export interface EntityIdentityIntentPayload {
  sessionId: string;
  source: EntityEditTarget;
  nextId: string;
}
