import type { SpecEditorDefinition } from '@/app/composables/spec-editor/spec-editor.types';
import { useSpecWeaponEditorDependencies } from './spec-editor/weapon/use-spec-weapon-editor-dependencies';
import { useSpecEditorDraftImages } from './spec-editor/use-spec-editor-draft-images';
import { querySpecShipEditorImages, querySpecShipEditorData } from '@/services/spec-ship-editor.service';
import type { useSpecEditorWindowViewModel } from './spec-editor/use-spec-editor-window-view-model';
import { querySpecSystemEditorData } from '@/services/spec-system-editor.service';
import { querySpecWeaponEditorData } from '@/services/spec-weapon-editor.service';
import { querySpecProjectileEditorData, querySpecProjectileEditorImages } from '@/services/spec-projectile-editor.service';
import { deepClone } from '@/shared/lib/starsector/index';
import type { SpecEditorKind, SpecEditorData } from '@/shared/types/index';

const readers = {
  ship: querySpecShipEditorData,
  weapon: querySpecWeaponEditorData,
  projectile: querySpecProjectileEditorData,
  system: querySpecSystemEditorData,
};
export function specEditorDefinition(kind: SpecEditorKind): SpecEditorDefinition<SpecEditorData> {
  return {
    read: readers[kind],
    project: (data) => deepClone(data.spec),
    accept: (data, spec) => ({ ...data, spec }),
    idField: kind === 'ship' ? 'hullId' : 'id',
  };
}

export function useSpecEditorDependencies(window: ReturnType<typeof useSpecEditorWindowViewModel>, kind: SpecEditorKind) {
  const weapon =
    kind === 'weapon'
      ? useSpecWeaponEditorDependencies({ target: window.currentTarget, draft: window.draftValue, context: window.editContext })
      : null;
  const ship =
    kind === 'ship'
      ? useSpecEditorDraftImages({
          target: window.currentTarget,
          draft: window.draftValue,
          context: window.editContext,
          fields: ['spriteName'],
          query: querySpecShipEditorImages,
        })
      : null;
  const projectile =
    kind === 'projectile'
      ? useSpecEditorDraftImages({
          target: window.currentTarget,
          draft: window.draftValue,
          context: window.editContext,
          fields: ['specClass', 'bulletSprite', 'sprite', 'glowSprite', 'textureType'],
          query: querySpecProjectileEditorImages,
          errorPresentation: 'inline',
        })
      : null;
  return { weapon, ship, projectile };
}
