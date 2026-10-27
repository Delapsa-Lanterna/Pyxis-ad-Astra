export type ProjectSessionId = string;

export type EntityKind = 'ship' | 'weapon' | 'projectile' | 'system' | 'skill' | 'faction' | 'mission' | 'variant' | 'skin';

export type JointEditKind = 'ship' | 'skin' | 'weapon' | 'wing' | 'variant';
export interface JointEditRoot {
  sessionId: string;
  modRoot: string;
  kind: JointEditKind;
  id: string;
}
export type MiscConfigKind = 'strings' | 'engineStyles' | 'hullStyles' | 'sounds' | 'settings';
export type JsonDocumentOrigin =
  | { kind: 'modInfo' }
  | { kind: 'miscConfig'; file: MiscConfigKind }
  | {
      kind: 'entity';
      target: { kind: Extract<EntityKind, 'faction' | 'mission' | 'variant' | 'skin'>; id: string; relPath: string | null };
    };

export const RESOURCE_SOURCES = ['mod', 'core'] as const;

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
  readonly source: ResourceSource;
  readonly relPath: string;
  readonly ownerKind: ResourceOwnerKind;
  readonly ownerId: string;
  readonly key: string;
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
