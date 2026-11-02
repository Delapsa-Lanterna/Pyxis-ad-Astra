import { observeSavedContent, saveProjection } from '@/orchestrators/project-sync.orchestrator';
import { openVariantImmersiveEditor } from '@/orchestrators/immersive-editor.orchestrator';
import { computed, onScopeDispose, ref, watch } from 'vue';
import { navigateToModTable } from '@/orchestrators/workspace-navigation.orchestrator';
import { querySessionEntityEditTarget } from '@/services/entity-query.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { observeSchemaSourceOptions } from '@/app/composables/editors/use-schema-source-options';
import { querySourceOptionCatalog } from '@/services/source-options.service';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { queryBuiltInWeaponSlotOptions, hasHullReferencesInvalidation } from '@/services/hull-reference.service';

import { hasResourceInvalidation } from '@/services/resource-media.service';
import { queryFactionPreviewImages, queryMissionDraftIcon } from '@/services/json-entity.service';
import { jsonDocumentContent } from '@/domain/json-editor/json-document-definitions';
import { AppError } from '@/shared/lib/errors';
import { isExternalSource } from '@/shared/lib/resource-ref';
import type { JsonDocumentSession } from './use-json-document-session';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { JsonDocumentDefinition } from '@/domain/json-editor/json-document-definitions';
import { composeJson, setCompositionValue } from '@/domain/schema/json-composition';
import type { JsonValue } from '@/shared/types';

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
    const context = {
      modRoot: target.modRoot,
      sessionId: target.sessionId,
      composition: document.composition.value
        ? {
            local: () => document.draftValue.value,
            sources: () => {
              const sources = document.composition.value!;
              return definition.kind === 'skin' || definition.kind === 'variant'
                ? sources
                : { ...sources, layers: sources.layers.map((layer) => ({ ...layer, data: { file: layer.data } })) };
            },
            apply: (path: string[], value: JsonValue | undefined) => {
              document.draftValue.value = setCompositionValue(document.draftValue.value, path, value);
            },
            root: definition.kind === 'skin' || definition.kind === 'variant' ? [] : ['file'],
          }
        : undefined,
    };
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
          : querySourceOptionCatalog(target.sessionId, source, signal),
      subscribeSourceOptionInvalidation: (source, resources, listener) =>
        source === 'hull:builtInWeaponSlots' || source === 'hull:weaponSlots' || source === 'hull:moduleSlots'
          ? observeSavedContent((event) => {
              const projection = saveProjection(event, target?.sessionId);
              if (!projection) return;
              if (projection.manifest.sessionId === target.sessionId && hasHullReferencesInvalidation(projection.invalidation))
                return listener();
            })
          : observeSchemaSourceOptions(context, source, resources, listener),
    };
  });
  watch(
    () => {
      if (definition.kind !== 'faction' && definition.kind !== 'mission') return [];
      const data = composeJson(jsonDocumentContent(definition.kind, document.draftValue.value), document.composition.value);
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
                composeJson(jsonDocumentContent(definition.kind, document.draftValue.value), document.composition.value),
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
    observeSavedContent((event) => {
      const projection = saveProjection(event, document.target.value!.sessionId);
      if (!projection) return;
      if (
        projection.manifest.sessionId === document.target.value!.sessionId &&
        hasResourceInvalidation(projection.invalidation, Object.values(document.record.value.resources))
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
      await reads.consume(
        'skin-hull-navigation',
        { target, id },
        (signal) => querySessionEntityEditTarget(target.sessionId, 'ship', id, signal),
        {
          ready: (info) => {
            if (!admitted() || document.target.value?.id !== target.id || String(document.draftValue.value.baseHullId ?? '').trim() !== id)
              return;
            if (isExternalSource(info.target.source?.source)) {
              feedback.info('船体「' + id + '」来自' + (info.target.source?.source === 'core' ? '原版' : '其他 Mod') + '。');
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
        },
      );
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
