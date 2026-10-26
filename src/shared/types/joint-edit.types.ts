import type { EntityEditTarget, EntityFileLocation, CsvTableKey, ResourceRef, FileVersion } from '@/shared/types/project-identity.types';
import type { JsonValue, DeepReadonly } from './json.types';
import type { JsonWriteOptions, WriteResult } from './write-commit.types';

export type JointEditKind = 'ship' | 'weapon' | 'wing' | 'variant';
export interface JointEditRoot {
  sessionId: string;
  modRoot: string;
  kind: JointEditKind;
  id: string;
}
export interface JointEditQuery {
  root: JointEditRoot;
  rowKey: string | null;
  values: Record<string, JointValue> | null;
  newSources: JointSourceCreate[];
  catalog: JointVariantCatalogKind | null;
  catalogSource?: import('./project-identity.types').ResourceSource;
}
export type JointVariantCatalogKind = 'weapons' | 'wings' | 'hullmods' | 'variants';
export interface JointVariantEntry {
  moduleHull?: { id: string; name: string; hints: string[] } | null;
  id: string;
  label: string;
  data: JsonValue;
  spec: JsonValue | null;
  specSource: EntityFileLocation | null;
  specVersion: FileVersion | null;
  source: EntityFileLocation;
  sourceVersion: FileVersion;
  resourceRefs: Record<string, ResourceRef>;
  preview: JointVariantPreview | null;
  projectile: JointPreviewSpec | null;
  primaryRole: string | null;
}
export type ReadonlyVariantEntry = DeepReadonly<JointVariantEntry>;
export interface JointPreviewSpec {
  kind: import('@/shared/types/project-identity.types').EntityKind;
  id: string;
  data: JsonValue;
  resourceRefs: Record<string, ResourceRef>;
  source: EntityFileLocation | null;
  sourceVersion: FileVersion | null;
}
export interface JointVariantPreview {
  hull: JointHullProjection;
  spec: JsonValue;
  specs: JointPreviewSpec[];
}
export interface JointVariantCatalogRead {
  root: JointEditRoot;
  referenceSettings: JointEditSnapshot['referenceSettings'];
  catalog: JointVariantCatalog;
}
export interface JointVariantCatalog {
  kind: JointVariantCatalogKind;
  entries: JointVariantEntry[];
}
export interface JointSourceCreate {
  kind: 'ship' | 'skin' | 'variant';
  id: string;
}
export interface EditWriteTarget {
  sessionId: string;
  modRoot: string;
  path: string;
}
export type JointRecordTarget =
  | { kind: 'spec'; target: EntityEditTarget }
  | { kind: 'csv'; table: CsvTableKey; rowKey: string; identity: Record<string, string>; write: EntityFileLocation }
  | { kind: 'text'; write: EntityFileLocation };
export type JointValue = { state: 'missing' } | { state: 'present'; value: JsonValue };
export interface JointEditRecord {
  key: string;
  target: JointRecordTarget;
  source: EntityFileLocation | null;
  sourceVersion: FileVersion | null;
  value: JointValue;
  baseVersions: FileVersion[];
  resourceRefs: Record<string, ResourceRef>;
  referencedBy: string[];
}
export interface JointEditSnapshot {
  root: JointEditRoot;
  bindings: Record<string, string>;
  referenceSettings: { values: Record<string, JsonValue>; versions: FileVersion[]; resources: Record<string, ResourceRef> };
  records: JointEditRecord[];
  baseVersions: FileVersion[];
  hull: JointHullProjection | null;
  newSources: JointSourceCreate[];
  variants: Record<string, JointHullProjection>;
  catalog: JointVariantCatalog | null;
}
export interface JointFieldBinding {
  recordKey: string;
  path: string;
}
export interface JointHullProjection {
  variantKey: string;
  hullKey: string;
  skinKeys: string[];
  fields: Record<string, JointFieldBinding>;
  displayBindings: Record<string, string>;
  weapons: Record<string, string>;
  sprite: ResourceRef | null;
  slots: JsonValue[];
  hints: string[];
  builtInWeapons: Record<string, string>;
  builtInMods: string[];
  builtInWings: string[];
  modules: Array<{ slotId: string; variantKey: string }>;
}
export interface JointEditDraft {
  baseline: JointEditSnapshot;
  values: Record<string, JointValue>;
}
export interface JointEditConflict {
  recordKey: string;
  path: string[];
  baseline: JointValue;
  disk: JointValue;
  draft: JointValue;
}
export interface JointEditPrepared {
  snapshot: JointEditSnapshot;
  values: Record<string, JointValue>;
  conflicts: JointEditConflict[];
}
export interface JointConflictChoice {
  recordKey: string;
  path: string[];
  choice: 'disk' | 'draft';
}
export interface SaveJointEditPayload {
  snapshot: JointEditSnapshot;
  values: Record<string, JointValue>;
  baseVersions: FileVersion[];
  jsonWrite: JsonWriteOptions;
  createOverrides: string[];
}
export type JointEditWriteResult = Omit<WriteResult, 'refreshedEntity'> & { refreshedEntity: JointEditSnapshot };

export interface EditHandoffRequest {
  requestId: string;
  ownerLabel: string;
  receiverLabel: string;
  targets: EditWriteTarget[];
}
export type EditHandoffReply = EditHandoffRequest &
  (
    | { status: 'ready'; receipts: WriteResult<unknown>[] }
    | { status: 'cancelled' }
    | { status: 'failed'; diagnostic: import('./error.types').ErrorDiagnostic }
  );
export type EditHandoffRelease = Pick<EditHandoffRequest, 'requestId' | 'ownerLabel' | 'receiverLabel'>;
