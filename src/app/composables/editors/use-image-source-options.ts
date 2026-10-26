import { ref, watch, onScopeDispose } from 'vue';
import { queryImageSourceOptions } from '@/services/source-options.service';
import { subscribeQueryInvalidations } from '@/services/query-cache.service';
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
  function reload() {
    reads.revoke();
    options.value = [];
    const identity = { sessionId: args.sessionId(), directories: args.directories() ?? [], missionId: args.missionId?.() ?? null };
    if (!args.active() || !identity.sessionId || !identity.directories.length) return;
    void reads.consume(
      'images',
      identity,
      (signal) => queryImageSourceOptions(identity.sessionId!, identity.directories, identity.missionId, signal),
      {
        ready: (groups) => {
          options.value = mapSourceGroupsToSelectOptions(groups);
        },
        error: (error) => feedback.error(error, '加载图片候选失败'),
      },
    );
  }
  watch(() => [args.sessionId(), JSON.stringify(args.directories()), args.missionId?.(), args.active()], reload, { immediate: true });
  onScopeDispose(
    subscribeQueryInvalidations((event) => {
      if (event.sessionId !== args.sessionId()) return;
      if (event.scope === 'session') {
        reads.revoke();
        options.value = [];
      } else reads.schedule('images', reload);
    }),
  );
  return options;
}
