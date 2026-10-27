import { subscribeProjectChanges, projectChangeSessionId } from '@/orchestrators/project-sync.orchestrator';
import { openVariantImmersiveEditor } from '@/orchestrators/immersive-editor.orchestrator';
import { computed, onScopeDispose, ref, watch } from 'vue';
import { navigateToModTable } from '@/orchestrators/workspace-navigation.orchestrator';
import { queryEntityEditTarget } from '@/orchestrators/window-target-focus.orchestrator';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { createSchemaRuntimeContext } from '@/app/composables/use-schema-runtime-context';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { queryBuiltInWeaponSlotOptions, hasHullReferencesInvalidation } from '@/services/hull-reference.service';

import { hasResourceInvalidation } from '@/services/resource-media.service';
import { queryFactionPreviewImages, queryMissionDraftIcon } from '@/services/json-entity.service';
import { jsonDocumentContent } from '@/domain/json-editor/json-document-definitions';
import { AppError } from '@/shared/lib/errors';
import type { JsonDocumentSession } from './use-json-document-session';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { JsonDocumentDefinition } from '@/domain/json-editor/json-document-definitions';

export function useJsonDocumentView(document: JsonDocumentSession, definition: JsonDocumentDefinition) {
  const feedback = useAppFeedback();
  const reads = useQueryReadOwner();
  const commands = useSaveCommandStore();
  const workspace = useWorkspaceStore();
  const previews = ref<Record<string, string>>({});
  const revision = ref(0);
  const canNavigateHull = computed(
    () => definition.kind === 'skin' && String(document.draftValue.value.baseHullId ?? '').trim().length > 0,
  );
  const schemaRuntimeContext = computed<SchemaRuntimeContext>(() => {
    const target = document.target.value!;
    const context = createSchemaRuntimeContext(target.modRoot, target.sessionId);
    if (definition.kind === 'mission') return { ...context, missionId: target.id };
    if (definition.kind !== 'skin' && definition.kind !== 'variant') return context;
    const hullId = String(document.draftValue.value[definition.kind === 'variant' ? 'hullId' : 'baseHullId'] ?? '');
    return {
      ...context,
      sourceContextKey: hullId,
      querySourceOptions: (source, signal) =>
        source === 'hull:builtInWeaponSlots' || source === 'hull:weaponSlots' || source === 'hull:moduleSlots'
          ? hullId
            ? queryBuiltInWeaponSlotOptions(
                target.sessionId,
                hullId,
                signal,
                source === 'hull:moduleSlots' ? 'moduleSlots' : source === 'hull:weaponSlots' ? 'weaponSlots' : 'builtInWeaponSlots',
              )
            : Promise.resolve([])
          : context.querySourceOptions!(source, signal),
      subscribeSourceOptionInvalidation: (source, resources, listener) =>
        source === 'hull:builtInWeaponSlots' || source === 'hull:weaponSlots' || source === 'hull:moduleSlots'
          ? subscribeProjectChanges((event) => {
              if (
                event.kind !== 'closed' &&
                projectChangeSessionId(event) === target.sessionId &&
                hasHullReferencesInvalidation(event.projection.invalidation)
              )
                listener();
            })
          : context.subscribeSourceOptionInvalidation!(source, resources, listener),
    };
  });
  watch(
    () => {
      if (definition.kind !== 'faction' && definition.kind !== 'mission') return [];
      const data = jsonDocumentContent(definition.kind, document.draftValue.value);
      return [data.logo, data.crest, data.icon, revision.value, document.active.value];
    },
    async () => {
      previews.value = {};
      reads.revoke();
      if (!document.active.value || (definition.kind !== 'faction' && definition.kind !== 'mission')) return;
      const target = document.target.value!;
      await reads.consume(
        'previews',
        target,
        async (signal) =>
          definition.kind === 'faction'
            ? queryFactionPreviewImages(
                target.sessionId,
                target.id,
                jsonDocumentContent(definition.kind, document.draftValue.value),
                signal,
              )
            : { icon: await queryMissionDraftIcon(target.sessionId, target.id, document.draftValue.value, signal) },
        {
          ready: (images) => {
            previews.value = { ...images };
          },
          error: (error) => feedback.error(error, '刷新 JSON 预览失败'),
        },
      );
    },
    { immediate: true },
  );
  onScopeDispose(
    subscribeProjectChanges((event) => {
      if (
        projectChangeSessionId(event) === document.target.value!.sessionId &&
        event.kind !== 'closed' &&
        hasResourceInvalidation(event.projection.invalidation, Object.values(document.record.value.resources))
      )
        revision.value++;
    }),
  );
  async function navigateToHull() {
    if (!canNavigateHull.value) return;
    const target = document.target.value!,
      admitted = document.inputs.captureContext();
    try {
      const waiting = commands.waitForSaves();
      if ((waiting && !(await waiting)) || !admitted()) return;
      const committed = document.inputs.commit();
      if (committed && !(await committed)) return;
      if (!admitted()) return;
      const id = String(document.draftValue.value.baseHullId ?? '').trim();
      await reads.consume('skin-hull-navigation', { target, id }, (signal) => queryEntityEditTarget(target.sessionId, 'ship', id, signal), {
        ready: (info) => {
          if (!admitted() || document.target.value?.id !== target.id || String(document.draftValue.value.baseHullId ?? '').trim() !== id)
            return;
          if (info.target.source?.source === 'core') {
            feedback.info('船体「' + id + '」来自原版。');
            return;
          }
          if (info.target.source?.source !== 'mod')
            throw new AppError('当前 Mod 没有船体记录「' + id + '」', { action: 'navigate-skin-hull' });
          const linked = info.target.linkedRecord;
          if (!linked || linked.kind !== 'csv' || linked.table !== 'ships')
            throw new AppError('船体「' + id + '」缺少可定位的舰船表格行', { action: 'navigate-skin-hull' });
          navigateToModTable(target.modRoot, 'ships');
          workspace.entityLocation = {
            sessionId: target.sessionId,
            modRoot: target.modRoot,
            kind: 'ship',
            id,
            rowKey: linked.rowKey,
          };
        },
        error: (error) => {
          if (admitted()) feedback.error(error, '跳转皮肤基础船体失败');
        },
      });
    } catch (error) {
      if (admitted()) feedback.error(error, '跳转皮肤基础船体失败');
    }
  }
  async function openImmersive() {
    const target = document.target.value!;
    try {
      await openVariantImmersiveEditor(
        { sessionId: target.sessionId, modRoot: target.modRoot, kind: definition.file!.immersiveKind!, id: target.id },
        feedback,
      );
    } catch (error) {
      feedback.error(error, '打开' + definition.label + '沉浸式编辑器失败');
    }
  }
  return { canNavigateHull, navigateToHull, previews, schemaRuntimeContext, openImmersive };
}
