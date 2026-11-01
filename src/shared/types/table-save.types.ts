import type { RowData } from '@/shared/types/json.types';
import type { WeaponSpecClass } from '@/shared/types/spec-editor.types';
import type { EntityEditTarget, EntityFileLocation, FileVersion, CsvTableKey } from '@/shared/types/project-identity.types';
import type { JsonWriteOptions } from '@/shared/types/json-write.types';

export type AssociatedSpecCreateParams =
  | { kind: 'ship'; id: string; hullName: string }
  | { kind: 'weapon'; id: string; specClass: WeaponSpecClass }
  | { kind: 'system'; id: string }
  | { kind: 'skill'; id: string };

export type AssociatedSpecChange =
  | { action: 'create'; create: AssociatedSpecCreateParams }
  | { action: 'delete'; id: string }
  | { action: 'rename'; previousId: string; create: AssociatedSpecCreateParams };

export interface AssociatedSpecWrite {
  change: AssociatedSpecChange;
  target: EntityEditTarget;
  resolution: AssociatedSpecResolution | null;
}

export interface AssociatedSpecFile {
  location: EntityFileLocation;
  version: FileVersion;
  problem: string | null;
}

export interface AssociatedSpecPreparation {
  target: EntityEditTarget;
  baseVersions: FileVersion[];
  original: AssociatedSpecFile | null;
  destination: AssociatedSpecFile;
}

export interface AssociatedSpecResolution {
  mode: 'read' | 'overwrite';
  original: AssociatedSpecFile | null;
  destination: AssociatedSpecFile;
}

export type CsvRowPatchAction = 'upsert' | 'delete';
export type CsvRowOrderEntry = string;

export interface CsvRowPatch {
  isComment: boolean;
  insertAt?: number | null;
  rowKey: string;
  action: CsvRowPatchAction;
  row: RowData;
}

export interface CsvSave {
  rowOrder: CsvRowOrderEntry[] | null;
  baseVersions: FileVersion[];
  sessionId: string;
  modRoot: string;
  table: CsvTableKey;
  patches: CsvRowPatch[];
  associatedSpecs: AssociatedSpecWrite[];
  jsonWrite?: JsonWriteOptions;
}
