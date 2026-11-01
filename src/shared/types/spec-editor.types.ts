import type { EntityEditInfo, FileVersion, EntityEditTarget } from '@/shared/types/project-identity.types';
import type { RowData } from './json.types';
import type { JsonComposition } from './json-composition.types';
import type { JsonWriteOptions } from '@/shared/types/json-write.types';

export const SPEC_EDITOR_KINDS = ['ship', 'weapon', 'projectile', 'system'] as const;
export type SpecEditorKind = (typeof SPEC_EDITOR_KINDS)[number];

export type WeaponSpecClass = 'projectile' | 'beam';
export type ProjectileSpecClass = 'projectile' | 'missile';

export interface SpecEditorData<K extends SpecEditorKind = SpecEditorKind> extends EntityEditInfo {
  composition?: JsonComposition;
  kind: K;
  spec: RowData;
  isNew: boolean;
}
export type SpecWeaponEditorData = SpecEditorData<'weapon'>;
export type SpecProjectileEditorData = SpecEditorData<'projectile'>;

export interface LoadImportedEditorSpecPayload {
  kind: SpecEditorKind;
  path: string;
}

export interface SpecSave {
  baseVersions: FileVersion[];
  sessionId: string;
  modRoot: string;
  target: EntityEditTarget;
  data: RowData;
  jsonWrite?: JsonWriteOptions;
  orderedJson?: string | null;
}
