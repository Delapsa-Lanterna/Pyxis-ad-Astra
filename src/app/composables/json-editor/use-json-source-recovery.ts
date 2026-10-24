import { computed, shallowRef, watch, type Ref } from 'vue';
import { miscConfigFile } from '@/domain/json-editor/misc-config-files';
import { prepareJsonSourceRecovery } from '@/services/json-recovery.service';
import { recreateJsonSourcesAction } from '@/orchestrators/json-save.orchestrator';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import type { EditTargetDraftSession, EditTargetDraftSessionOptions } from '@/app/composables/use-edit-target-draft-session';
import type { ConfigDocumentTarget } from '@/domain/json-editor/json-document-definitions';
import type { JsonDocumentMeta } from './json-document-capabilities';
import type { DocumentSaveResult } from '@/shared/runtime/document-editor';
import type { AppFeedback, JsonRecoveryPlan, JsonRecoveryRequest, RowData } from '@/shared/types';
import { deepClone } from '@/shared/lib/starsector';

export function useJsonSourceRecovery(options: {
  feedback: AppFeedback;
  session: EditTargetDraftSession<RowData, ConfigDocumentTarget, JsonDocumentMeta>;
  active: Readonly<Ref<boolean>>;
  save: (write: EditTargetDraftSessionOptions<RowData, ConfigDocumentTarget, JsonDocumentMeta>['save']) => Promise<DocumentSaveResult>;
}) {
  const { session } = options;
  const plan = shallowRef<JsonRecoveryPlan | null>(null);
  const reads = useQueryReadOwner();
  const feedback = options.feedback;
  async function refresh() {
    const target = session.currentTarget.value!;
    const request: JsonRecoveryRequest = {
      sessionId: target.sessionId,
      modRoot: target.modRoot,
      origin:
        target.kind === 'misc-config'
          ? { kind: 'miscConfig', file: miscConfigFile(target.id).kind }
          : target.kind === 'mod-info'
            ? { kind: 'modInfo' }
            : {
                kind: 'entity',
                target: {
                  sessionId: target.sessionId,
                  modRoot: target.modRoot,
                  kind: target.kind,
                  id: target.id,
                  relPath: target.entity!.write.relPath,
                },
              },
    };
    await reads.consume('recovery', request, () => prepareJsonSourceRecovery(request), {
      ready: (value) => {
        plan.value = value;
      },
    });
  }
  async function recreate() {
    try {
      return (
        (
          await options.save(async () => {
            await refresh();
            const prepared = plan.value!;
            if (!prepared.missingPaths.length) return;
            const choice = await feedback.choose({
              title: '重新创建来源',
              content: [
                '按最后保存的字段基线恢复以下来源：',
                ...prepared.missingPaths,
                'JSON 文件使用标准排版；缓存持有解析后的字段，源文件原文已缺失。',
              ].join('\n'),
              choices: [{ label: '重新创建', value: 'recreate', type: 'primary' }],
            });
            if (choice !== 'recreate') return;
            const baseline = deepClone(session.baselineSnapshot.value!);
            const result = await recreateJsonSourcesAction(prepared, baseline.value, feedback, session.currentTargetKey.value!);
            if (!result) return;
            const restored = result.baseVersions.filter((version) =>
              prepared.missingPaths.some(
                (path) =>
                  version.path.replaceAll('\\', '/').endsWith('/' + path) ||
                  (baseline.target.modRoot.replaceAll('\\', '/') + '/' + path).startsWith(version.path.replaceAll('\\', '/') + '/'),
              ),
            );
            return {
              ...baseline,
              baseVersions: [...new Map([...baseline.baseVersions, ...restored].map((version) => [version.path, version])).values()],
              commitId: result.commitId,
              meta: { ...baseline.meta, receipt: result, recovery: result.refreshedEntity! },
            };
          })
        ).status === 'saved'
      );
    } catch (error) {
      feedback.error(error, '重新创建 JSON 来源失败');
      return false;
    }
  }
  watch(options.active, (enabled) => {
    if (!enabled) reads.revoke();
  });
  return {
    missing: computed(() => Boolean(plan.value?.missingPaths.length)),
    refresh,
    recreate,
    accept: (value: JsonRecoveryPlan) => {
      plan.value = value;
    },
  };
}
