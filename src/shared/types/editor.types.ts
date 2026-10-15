import type { SpecEditorKind } from './spec-editor.types';

export type WeaponSpecClass = 'projectile' | 'beam';
export type ProjectileSpecClass = 'projectile' | 'missile';
export type EditorResourceKind = SpecEditorKind | 'faction' | 'mission';

export interface EditableFileData {
  entity: import('@/shared/types/project-identity.types').EntityEditInfo | null;
  path: string;
  text: string;
  baseVersions: import('@/shared/types/project-identity.types').FileVersion[];
}
