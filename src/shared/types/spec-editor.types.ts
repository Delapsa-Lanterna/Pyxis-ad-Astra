import type { EntityEditInfo } from '@/shared/types/project-identity.types';
import type { RowData } from './json.types';
export const SPEC_EDITOR_KINDS = ['ship', 'weapon', 'projectile', 'system'] as const;
export type SpecEditorKind = (typeof SPEC_EDITOR_KINDS)[number];

export interface SpecEditorData<K extends SpecEditorKind = SpecEditorKind> extends EntityEditInfo {
  kind: K;
  spec: RowData;
  isNew: boolean;
}
export type SpecWeaponEditorData = SpecEditorData<'weapon'>;
export type SpecProjectileEditorData = SpecEditorData<'projectile'>;
