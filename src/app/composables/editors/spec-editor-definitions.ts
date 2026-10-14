import { useWeaponEditorDependencies } from './use-weapon-editor-dependencies';
import { useEditorDraftImages } from './use-editor-draft-images';
import { queryShipEditorImages } from '@/services/editor.service';
import type { useEditorWindowViewModel } from './use-editor-window-view-model';
import { queryShipEditorData, querySystemEditorData } from '@/services/editor.service';
import { queryWeaponEditorData } from '@/services/weapon-editor.service';
import { queryProjectileEditorData, queryProjectileEditorImages } from '@/services/projectile-editor.service';
import { deepClone } from '@/shared/lib/starsector';
import type { EditorSpecKind, RowData, SpecEditorData } from '@/shared/types';

export interface SpecEditorDefinition<TData extends SpecEditorData> {
  read: (sessionId: string, id: string, signal?: AbortSignal) => Promise<TData>;
  project: (data: TData) => RowData;
  accept: (data: TData, spec: RowData) => TData;
  idField: string;
}
const readers = {
  ship: queryShipEditorData,
  weapon: queryWeaponEditorData,
  projectile: queryProjectileEditorData,
  system: querySystemEditorData,
};
export function specEditorDefinition(kind: EditorSpecKind): SpecEditorDefinition<SpecEditorData> {
  return {
    read: readers[kind],
    project: (data) => deepClone(data.spec),
    accept: (data, spec) => ({ ...data, spec }),
    idField: kind === 'ship' ? 'hullId' : 'id',
  };
}

export function useSpecEditorDependencies(window: ReturnType<typeof useEditorWindowViewModel>, kind: EditorSpecKind) {
  const weapon = kind === 'weapon' ? useWeaponEditorDependencies(window) : null;
  const ship =
    kind === 'ship'
      ? useEditorDraftImages({
          target: window.currentTarget,
          draft: window.draftValue,
          context: window.editContext,
          fields: ['spriteName'],
          query: queryShipEditorImages,
        })
      : null;
  const projectile =
    kind === 'projectile'
      ? useEditorDraftImages({
          target: window.currentTarget,
          draft: window.draftValue,
          context: window.editContext,
          fields: ['specClass', 'bulletSprite', 'sprite'],
          query: queryProjectileEditorImages,
          errorPresentation: 'inline',
        })
      : null;
  return { weapon, ship, projectile };
}
