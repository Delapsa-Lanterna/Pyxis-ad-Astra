import type { SpecEditorDefinition } from '@/app/composables/spec-editor/spec-editor.types';
import { useSpecWeaponEditorDependencies } from './spec-editor/weapon/use-spec-weapon-editor-dependencies';
import { useSpecEditorDraftImages } from './spec-editor/use-spec-editor-draft-images';
import { querySpecShipEditorImages, querySpecShipEditorData } from '@/services/spec-ship-editor.service';
import type { useSpecEditorWindowViewModel } from './spec-editor/use-spec-editor-window-view-model';
import { querySpecSystemEditorData } from '@/services/spec-system-editor.service';
import { querySpecWeaponEditorData } from '@/services/spec-weapon-editor.service';
import { querySpecProjectileEditorData, querySpecProjectileEditorImages } from '@/services/spec-projectile-editor.service';
import type { SpecEditorKind, SpecEditorData } from '@/shared/types/index';
import { shipSpecIssues } from '@/domain/spec-editor/ship/spec-ship-fields';
import { weaponSpecIssues } from '@/domain/spec-editor/weapon/spec-weapon-fields';
import { projectileSpecIssues } from '@/domain/spec-editor/projectile/spec-projectile-fields';
import { systemSpecIssues } from '@/domain/spec-editor/system/spec-system-fields';

export const specEditorDefinitions: Record<SpecEditorKind, SpecEditorDefinition<SpecEditorData>> = {
  ship: { read: querySpecShipEditorData, validate: shipSpecIssues, idField: 'hullId' },
  weapon: { read: querySpecWeaponEditorData, validate: weaponSpecIssues, idField: 'id' },
  projectile: { read: querySpecProjectileEditorData, validate: projectileSpecIssues, idField: 'id' },
  system: { read: querySpecSystemEditorData, validate: systemSpecIssues, idField: 'id' },
};

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
