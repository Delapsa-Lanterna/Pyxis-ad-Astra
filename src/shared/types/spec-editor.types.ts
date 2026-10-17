import type { EntityEditInfo } from '@/shared/types/project-identity.types';
import type { RowData } from './json.types';
export const SPEC_EDITOR_KINDS = ['ship', 'weapon', 'projectile', 'system'] as const;
export type SpecEditorKind = (typeof SPEC_EDITOR_KINDS)[number];

export type WeaponSpecClass = 'projectile' | 'beam';
export type ProjectileSpecClass = 'projectile' | 'missile';

export interface SpecEditorData<K extends SpecEditorKind = SpecEditorKind> extends EntityEditInfo {
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

export interface SaveEditorSpecPayload {
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
  sessionId: string;
  modRoot: string;
  target: import('@/shared/types/project-identity.types').EntityEditTarget;
  data: RowData;
  jsonWrite?: import('@/shared/types/write-commit.types').JsonWriteOptions;
  orderedJson?: string | null;
}
