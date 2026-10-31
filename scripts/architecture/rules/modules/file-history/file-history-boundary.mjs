import { defineRule } from '../../../diagnostics.mjs';
import { callsFrom } from '../../../facts/imports.mjs';

const historyStore = new Set(['src/stores/file-history.store.ts']);
const historyService = new Set(['src/services/file-history.service.ts']);
const snapshotOwners = new Set([
  'src/app/composables/editors/use-file-history-view-model.ts',
  'src/orchestrators/file-history-replay.orchestrator.ts',
  'src/orchestrators/project-sync.orchestrator.ts',
]);
const replayOwners = new Set(['src/orchestrators/file-history-replay.orchestrator.ts']);

export const fileHistoryBoundaryRule = defineRule(
  'file-history-boundary',
  '.zcode/modules/file-history.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      for (const call of callsFrom(file, context.byPath, historyStore))
        if (call.name === 'applySnapshot' && !snapshotOwners.has(file.rel))
          report(file, call, 'file history snapshots must be accepted by an owned history consumer', {
            target: call.origin.rel,
            symbol: call.name,
            expected: [...snapshotOwners].join(', '),
          });

      for (const call of callsFrom(file, context.byPath, historyService))
        if (call.name === 'replayFileChangeSet' && !replayOwners.has(file.rel))
          report(file, call, 'file history replay must be owned by the replay orchestrator', {
            target: call.origin.rel,
            symbol: call.name,
            expected: [...replayOwners].join(', '),
          });

      for (const array of file.frontend.emptyTypedArrays)
        if (array.type === 'FileChangeRecord[]' || array.type.endsWith('<FileChangeRecord>'))
          report(file, array, 'file history changesets must come from write results, not ad hoc empty arrays', {
            symbol: array.type,
            expected: 'WriteResult.changes',
          });
    }
  },
);
