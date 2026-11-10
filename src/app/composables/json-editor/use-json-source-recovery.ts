import { computed, shallowRef, watch, type Ref } from 'vue';
import { prepareJsonSourceRecovery } from '@/services/json-recovery.service';
import { recreateJsonSources } from '@/services/json-recovery.service';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { createJsonDocument } from '@/domain/json-document';
import { jsonRecoveryValue, jsonDocumentOrigin, type ConfigDocumentTarget } from '@/domain/json-editor/json-document-definitions';
import type { JsonDocumentSnapshot, JsonDocumentWriter } from './json-document-capabilities';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';
import type { AppFeedback, JsonRecoveryPlan } from '@/shared/types';

export function useJsonSourceRecovery(options: {
  feedback: AppFeedback;
  session: {
    currentTarget: Readonly<Ref<ConfigDocumentTarget | null>>;
    currentTargetKey: Readonly<Ref<string | null>>;
    baselineSnapshot: Readonly<Ref<JsonDocumentSnapshot>>;
  };
  active: Readonly<Ref<boolean>>;
  save: (write: JsonDocumentWriter) => Promise<DocumentSaveResult>;
}) {
  const { session, feedback } = options,
    reads = useQueryReadOwner();
  const plan = shallowRef<JsonRecoveryPlan | null>(null);
  async function refresh() {
    const target = session.currentTarget.value!;
    const request = { sessionId: target.sessionId, modRoot: target.modRoot, origin: jsonDocumentOrigin(target) };
    const accepted = await reads.consume('recovery', request, () => prepareJsonSourceRecovery(request), {
      ready: (value) => {
        plan.value = value;
      },
    });
    return accepted ? plan.value : null;
  }
  async function recreate() {
    try {
      return (
        (
          await options.save(async (_target, _draft, _versions, _original, _capture, request) => {
            const prepared = await refresh();
            if (!prepared?.missingPaths.length) return;
            const choice = await feedback.choose({
              title: '重新创建来源文件？',
              content: '使用最后保存的内容重新创建以下文件，当前编辑继续保留。\n\n' + prepared.missingPaths.join('\n'),
              choices: [{ label: '重新创建', value: 'recreate', type: 'primary' }],
              cancelText: '返回编辑',
            });
            if (choice !== 'recreate') return;
            const baseline = session.baselineSnapshot.value;
            const key = baseline.target.kind === 'mission' ? 'descriptor' : 'file';
            const result = await recreateJsonSources(
              {
                ...prepared.request,
                plan: prepared,
                baseline: baseline.value,
                originals: { [key]: baseline.meta.document },
                documents: { [key]: createJsonDocument(baseline.meta.document).capture('expanded').request },
              },
              request,
            );
            const actual = result.content!.value;
            return {
              ...baseline,
              value: jsonRecoveryValue(baseline.target, actual, baseline.value),
              baseVersions: result.baseVersions,
              requestId: result.requestId,
              meta: {
                ...baseline.meta,
                document: actual.documents[key]!,
                receipt: result,
                resources: actual.resourceRefs,
                recovery: actual,
              },
            };
          })
        ).status === 'saved'
      );
    } catch (error) {
      feedback.error(error, '重新创建 JSON 来源失败');
      return false;
    }
  }
  watch(
    options.active,
    (enabled) => {
      if (!enabled) reads.revoke();
    },
    { flush: 'sync' },
  );
  watch(
    session.currentTargetKey,
    () => {
      reads.revoke();
      plan.value = null;
    },
    { flush: 'sync' },
  );
  return { refresh, recreate, missing: computed(() => Boolean(plan.value?.missingPaths.length)), cancelRead: () => reads.revoke() };
}
