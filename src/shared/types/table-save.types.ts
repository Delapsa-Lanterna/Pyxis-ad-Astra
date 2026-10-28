import type { RowData } from '@/shared/types/json.types';

export type AssociatedSpecCreateParams =
  | { kind: 'ship'; id: string; hullName: string }
  | { kind: 'weapon'; id: string; specClass: import('@/shared/types/spec-editor.types').WeaponSpecClass }
  | { kind: 'system'; id: string }
  | { kind: 'skill'; id: string };

export type AssociatedSpecChange =
  | { action: 'create'; create: AssociatedSpecCreateParams }
  | { action: 'delete'; id: string }
  | { action: 'rename'; previousId: string; create: AssociatedSpecCreateParams };

export interface AssociatedSpecWrite {
  change: AssociatedSpecChange;
  target: import('@/shared/types/project-identity.types').EntityEditTarget;
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
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  sessionId: string;
  modRoot: string;
  table: import('@/shared/types/project-identity.types').CsvTableKey;
  patches: CsvRowPatch[];
  associatedSpecs: AssociatedSpecWrite[];
  jsonWrite?: import('@/shared/types/write-commit.types').JsonWriteOptions;
}
