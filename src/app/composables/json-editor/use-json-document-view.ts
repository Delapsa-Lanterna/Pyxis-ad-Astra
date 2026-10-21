import { openVariantImmersiveEditor } from '@/orchestrators/immersive-editor.orchestrator';
import { computed, onScopeDispose, ref, watch } from 'vue';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { createSchemaRuntimeContext } from '@/app/composables/use-schema-runtime-context';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { queryBuiltInWeaponSlotOptions } from '@/services/hull-reference.service';
import { hasQueryInvalidation, subscribeQueryInvalidations } from '@/services/query-cache.service';
import { hasResourceInvalidation, subscribeResourceInvalidations } from '@/services/resource-media.service';
import { queryFactionPreviewImages, queryMissionDraftIcon } from '@/services/json-entity.service';
import { jsonDocumentContent } from '@/domain/json-editor/json-document-definitions';
import type { JsonDocumentSession } from './use-json-document-session';
import type { SchemaRuntimeContext } from '@/domain/schema/schema-runtime';
import type { JsonDocumentDefinition } from '@/domain/json-editor/json-document-definitions';

export function useJsonDocumentView(document: JsonDocumentSession, definition: JsonDocumentDefinition) {
  const feedback = useAppFeedback();
  const reads = useQueryReadOwner();
  const previews = ref<Record<string, string>>({});
  const revision = ref(0);
  const schemaRuntimeContext = computed<SchemaRuntimeContext>(() => {
    const target = document.target.value!;
    const context = createSchemaRuntimeContext(target.modRoot, target.sessionId);
    if (definition.kind === 'mission') return { ...context, missionId: target.id };
    if (definition.kind !== 'skin') return context;
    const hullId = String(document.draftValue.value.baseHullId ?? '');
    return {
      ...context,
      sourceContextKey: hullId,
      querySourceOptions: (source, signal) =>
        source === 'hull:builtInWeaponSlots'
          ? hullId
            ? queryBuiltInWeaponSlotOptions(target.sessionId, hullId, signal)
            : Promise.resolve([])
          : context.querySourceOptions!(source, signal),
      subscribeSourceOptionInvalidation: (source, resources, listener) =>
        source === 'hull:builtInWeaponSlots'
          ? subscribeQueryInvalidations((event) => {
              if (event.scope !== 'session' && event.sessionId === target.sessionId && hasQueryInvalidation(event, 'hull-references'))
                listener();
            })
          : context.subscribeSourceOptionInvalidation!(source, resources, listener),
    };
  });
  watch(
    () => {
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
    subscribeResourceInvalidations((event) => {
      if (
        event.sessionId === document.target.value!.sessionId &&
        hasResourceInvalidation(event, Object.values(document.record.value.resources))
      )
        revision.value++;
    }),
  );
  async function openImmersive() {
    const target = document.target.value!;
    try {
      await openVariantImmersiveEditor({ sessionId: target.sessionId, modRoot: target.modRoot, kind: 'variant', id: target.id }, feedback);
    } catch (error) {
      feedback.error(error, '打开装配沉浸式编辑器失败');
    }
  }
  return { previews, schemaRuntimeContext, openImmersive };
}
