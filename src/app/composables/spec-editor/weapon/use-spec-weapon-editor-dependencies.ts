import { hasEntityInvalidation } from '@/services/entity-query.service';
import { computed, shallowRef, watch, onScopeDispose } from 'vue';
import { querySpecWeaponEditorImages, querySpecWeaponProjectileOptions } from '@/services/spec-weapon-editor.service';
import { subscribeQueryInvalidations } from '@/services/query-cache.service';
import { createReadTicketOwner } from '@/shared/runtime/read-request';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
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
  const projectileOptions = shallowRef<Array<{ label: string; value: string }>>([]);
  const reads = createReadTicketOwner(),
    feedback = useAppFeedback();
  async function refreshOptions() {
    const target = input.target.value;
    if (!target || !input.context.value) return;
    await reads.consume(
      'options',
      { sessionId: target.sessionId },
      (signal) => querySpecWeaponProjectileOptions(target.sessionId, signal),
      {
        ready: (value) => {
          projectileOptions.value = value;
        },
        error: (error) => feedback.error(error, '读取弹体选项失败'),
      },
    );
  }
  watch(
    () => {
      const target = input.target.value,
        context = input.context.value;
      return target && context ? JSON.stringify([target.sessionId, context.baselineGeneration]) : null;
    },
    () => {
      reads.revoke();
      reads.schedule('options', () => void refreshOptions());
    },
    { immediate: true, flush: 'sync' },
  );
  const stop = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== input.target.value?.sessionId) return;
    if (event.scope === 'session') {
      reads.revoke('session');
      return;
    }
    if (hasEntityInvalidation(event, 'entity-list', 'projectile')) reads.schedule('options', () => void refreshOptions());
  });
  function dispose() {
    images.dispose();
    reads.revoke();
    stop();
  }
  onScopeDispose(dispose);
  return {
    spriteData: computed(() => images.value.value?.spriteData ?? {}),
    resourceRefs: computed(() => images.value.value?.resourceRefs ?? []),
    projectileOptions: computed(() => projectileOptions.value),
    dispose,
  };
}
