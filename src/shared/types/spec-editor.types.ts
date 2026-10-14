import type { EditorSpecKind } from './editor.types';
import type { EntityEditInfo } from './entity-target.types';
import type { RowData } from './json.types';
export interface SpecEditorData<K extends EditorSpecKind = EditorSpecKind> extends EntityEditInfo {
  kind: K;
  spec: RowData;
  isNew: boolean;
}
export type WeaponEditorData = SpecEditorData<'weapon'>;
export type ProjectileEditorData = SpecEditorData<'projectile'>;
