import type { EntityEditTarget, EntityTargetSnapshot, FileVersion } from './project-identity.types';
import type { JsonComposition } from './json-composition.types';
import type { JsonWriteOptions } from './json-write.types';
import type { JsonFileContent, JsonFileWrite } from './file-content.types';
import type { RowData } from './json.types';

export const SPEC_EDITOR_KINDS = ['ship', 'weapon', 'projectile', 'system'] as const;
export type SpecEditorKind = (typeof SPEC_EDITOR_KINDS)[number];
export type WeaponSpecClass = 'projectile' | 'beam';
export type ProjectileSpecClass = 'projectile' | 'missile';
export interface SpecEditorData<K extends SpecEditorKind = SpecEditorKind> extends EntityTargetSnapshot {
  kind: K;
  document: JsonFileContent | null;
  spec: RowData;
  composition?: JsonComposition;
  isNew: boolean;
}
export type SpecWeaponEditorData = SpecEditorData<'weapon'>;
export type SpecProjectileEditorData = SpecEditorData<'projectile'>;
export interface LoadImportedEditorSpecPayload {
  kind: SpecEditorKind;
  path: string;
}
export interface SpecSave {
  sessionId: string;
  modRoot: string;
  baseVersions: FileVersion[];
  target: EntityEditTarget;
  document: JsonFileWrite;
  jsonWrite: JsonWriteOptions;
}
