import { computed, shallowRef, watch, onScopeDispose } from 'vue';
import { queryWeaponEditorImages, queryWeaponProjectileOptions } from '@/services/weapon-editor.service';
import { subscribeQueryInvalidations, hasEntityInvalidation } from '@/services/query-cache.service';
import { createReadTicketOwner } from '@/shared/runtime/read-request';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { WEAPON_SPRITE_FIELDS } from '@/domain/editors/lib/weapon-sprite-fields';
import { useEditorDraftImages } from './use-editor-draft-images';
import type { useEditorWindowViewModel } from './use-editor-window-view-model';

export function useWeaponEditorDependencies(window: ReturnType<typeof useEditorWindowViewModel>) {
  const images = useEditorDraftImages({
    target: window.currentTarget,
    draft: window.draftValue,
    context: window.editContext,
    fields: WEAPON_SPRITE_FIELDS,
    query: queryWeaponEditorImages,
  });
  const projectileOptions = shallowRef<Array<{ label: string; value: string }>>([]);
  const reads = createReadTicketOwner(),
    feedback = useAppFeedback();
  async function refreshOptions() {
    const target = window.currentTarget.value;
    if (!target || !window.editContext.value) return;
    await reads.consume('options', { sessionId: target.sessionId }, (signal) => queryWeaponProjectileOptions(target.sessionId, signal), {
      ready: (value) => {
        projectileOptions.value = value;
      },
      error: (error) => feedback.error(error, '读取弹体选项失败'),
    });
  }
  watch(
    () => {
      const target = window.currentTarget.value,
        context = window.editContext.value;
      return target && context ? JSON.stringify([target.sessionId, context.baselineGeneration]) : null;
    },
    () => {
      reads.revoke();
      reads.schedule('options', () => void refreshOptions());
    },
    { immediate: true, flush: 'sync' },
  );
  const stop = subscribeQueryInvalidations((event) => {
    if (event.sessionId !== window.currentTarget.value?.sessionId) return;
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
