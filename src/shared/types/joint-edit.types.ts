import type { EntityEditTarget, EntityFileLocation } from './entity-target.types';
import type { TableKey } from './tables.types';
import type { ResourceRef } from './query.types';
import type { JsonValue } from './json.types';
import type { FileVersion, JsonWriteOptions, WriteResult } from './write.types';

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
}
export interface EditWriteTarget {
  sessionId: string;
  modRoot: string;
  path: string;
}
export type JointRecordTarget =
  | { kind: 'spec'; target: EntityEditTarget }
  | { kind: 'csv'; table: TableKey; rowKey: string; identity: Record<string, string>; write: EntityFileLocation }
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
  referenceSettings: { values: Record<string, JsonValue>; versions: FileVersion[] };
  records: JointEditRecord[];
  baseVersions: FileVersion[];
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
