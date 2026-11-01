import type { JsonValue, RowData } from '@/shared/types/json.types';
import type { FileVersion, EntityEditTarget } from '@/shared/types/project-identity.types';
import type { JsonWriteOptions } from '@/shared/types/json-write.types';

export interface JsonFileSave {
  baseVersions: FileVersion[];
  sessionId: string;
  modRoot: string;
  previousId: string | null;
  nextId: string;
  data: RowData;
  relPath: string | null;
  jsonWrite?: JsonWriteOptions;
  orderedJson?: string | null;
}

export interface JsonFileDelete {
  baseVersions: FileVersion[];
  sessionId: string;
  modRoot: string;
  entityId: string;
  relPath: string;
}

export interface JsonEntityFile {
  target: EntityEditTarget;
  id: string;
  baseVersions: FileVersion[];
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
