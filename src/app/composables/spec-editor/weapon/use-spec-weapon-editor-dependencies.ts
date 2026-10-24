import { computed, onScopeDispose } from 'vue';
import { querySpecWeaponEditorImages } from '@/services/spec-weapon-editor.service';
import { WEAPON_SPRITE_FIELDS } from '@/domain/editors/lib/weapon-sprite-fields';
import { useSpecEditorDraftImages } from '../use-spec-editor-draft-images';
import type { SpecEditorInput } from '../spec-editor.types';

export function useSpecWeaponEditorDependencies(input: SpecEditorInput) {
  const images = useSpecEditorDraftImages({
    target: input.target,
    draft: input.draft,
    context: input.context,
    fields: [...WEAPON_SPRITE_FIELDS, 'textureType'],
    query: querySpecWeaponEditorImages,
  });
  onScopeDispose(images.dispose);
  return {
    notices: computed(() => [images.errorText.value, images.value.value?.diagnostic].filter((value): value is string => Boolean(value))),
    spriteData: computed(() => images.value.value?.spriteData ?? {}),
    resourceRefs: computed(() => images.value.value?.resourceRefs ?? []),
    dispose: images.dispose,
  };
}
