import { defineRule } from '../../../diagnostics.mjs';
import { callsFrom } from '../../../facts/imports.mjs';

const sources = new Set(['src/stores/file-history.store.ts', 'src/services/file-history.service.ts']);
const owners = new Map([
  ['pushSavedWriteEntry', new Set(['orchestrators/project-sync', 'stores/file-history'])],
  ['commitReplayUndo', new Set(['orchestrators/file-history-replay', 'stores/file-history'])],
  ['commitReplayRedo', new Set(['orchestrators/file-history-replay', 'stores/file-history'])],
  ['replayFileChangeSet', new Set(['orchestrators/file-history-replay'])],
]);
const eventSource = 'src/windows/tauri.events.ts';

export const fileHistoryBoundaryRule = defineRule(
  'file-history-boundary',
  '.zcode/modules/file-history.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      const owner = file.role.layer + '/' + file.role.domain;
      for (const call of callsFrom(file, context.byPath, sources)) {
        const allowed = owners.get(call.name);
        if (allowed && !allowed.has(owner))
          report(file, call, 'file history operation must be owned by its commit or replay boundary', {
            target: call.origin.rel,
            symbol: call.name,
            expected: [...allowed].join(', '),
          });
      }
      for (const array of file.frontend.emptyTypedArrays)
        if (array.type === 'FileChangeRecord[]' || array.type.endsWith('<FileChangeRecord>'))
          report(file, array, 'file history changesets must come from write results, not ad hoc empty arrays', {
            symbol: array.type,
            expected: 'WriteResult.changes',
          });
      for (const call of callsFrom(file, context.byPath, new Set([eventSource])))
        if (
          call.name === 'emitWindowEvent' &&
          (call.arguments.includes('fileEditorTextApplied') || call.argumentExpressions.includes('WINDOW_EVENTS.fileEditorTextApplied')) &&
          owner !== 'orchestrators/file-history-replay'
        )
          report(file, call, 'file editor replay sync must be emitted by File History Replay', {
            target: eventSource,
            symbol: 'fileEditorTextApplied',
            expected: 'orchestrators/file-history-replay',
          });
    }
  },
);
