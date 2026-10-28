import { observeSavedContent, saveProjection } from '@/orchestrators/project-sync.orchestrator';
import { ref, watch, onScopeDispose } from 'vue';
import { queryImageSourceOptions } from '@/services/source-options.service';

import { mapSourceGroupsToSelectOptions, type SelectOption } from '@/domain/schema/schema-options';
import { useQueryReadOwner } from '@/app/composables/use-query-read-owner';
import { useAppFeedback } from '@/app/composables/use-app-feedback';

export function useImageSourceOptions(args: {
  sessionId: () => string | undefined;
  directories: () => string[] | undefined;
  missionId?: () => string | undefined;
  active: () => boolean;
}) {
  const options = ref<SelectOption[]>([]);
  const reads = useQueryReadOwner();
  const feedback = useAppFeedback();
  function reload(required = false) {
    reads.revoke();
    options.value = [];
    const identity = { sessionId: args.sessionId(), directories: args.directories() ?? [], missionId: args.missionId?.() ?? null };
    if (!args.active() || !identity.sessionId || !identity.directories.length) return;
    return reads.consume(
      'images',
      identity,
      (signal) => queryImageSourceOptions(identity.sessionId!, identity.directories, identity.missionId, signal),
      {
        ready: (groups) => {
          options.value = mapSourceGroupsToSelectOptions(groups);
        },
        error: (error) => {
          feedback.error(error, '加载图片候选失败');
          if (required) throw error;
        },
      },
    );
  }
  watch(
    () => [args.sessionId(), JSON.stringify(args.directories()), args.missionId?.(), args.active()],
    () => {
      void reload();
    },
    { immediate: true },
  );
  onScopeDispose(
    observeSavedContent(
      (event) => {
        const projection = saveProjection(event, args.sessionId());
        if (!projection) return;
        if (projection.manifest.sessionId !== args.sessionId()) return;
        return reload(true);
      },
      (sessionId) => {
        if (sessionId === args.sessionId()) {
          reads.revoke('session');
          options.value = [];
        }
      },
    ),
  );
  return options;
}
