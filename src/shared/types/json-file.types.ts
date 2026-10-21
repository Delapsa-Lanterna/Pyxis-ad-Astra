import type { JsonValue, RowData } from '@/shared/types/json.types';

export interface JsonEntityFilePayload {
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  sessionId: string;
  modRoot: string;
  previousId: string | null;
  nextId: string;
  data: RowData;
  relPath: string | null;
  jsonWrite?: import('@/shared/types/write-commit.types').JsonWriteOptions;
  orderedJson?: string | null;
}

export interface DeleteJsonEntityFilePayload {
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  sessionId: string;
  modRoot: string;
  entityId: string;
  relPath: string;
}

export interface JsonEntityFile {
  target: import('@/shared/types/project-identity.types').EntityEditTarget;
  id: string;
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  path: string;
  relPath: string;
  data: RowData;
}

export interface VariantFile extends RowData {
  variantId: string;
  hullId: string;
  path: string;
  relPath: string;
  data: JsonValue;
  weaponGroupCount: number;
  hullModCount: number;
  permaModCount: number;
  wingCount: number;
}

export interface SkinFile extends RowData {
  skinHullId: string;
  baseHullId: string;
  path: string;
  relPath: string;
  data: JsonValue;
  builtInModCount: number;
  builtInWeaponCount: number;
  builtInWingCount: number;
  weaponSlotChangeCount: number;
  engineSlotChangeCount: number;
}
