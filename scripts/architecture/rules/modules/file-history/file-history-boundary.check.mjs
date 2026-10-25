import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { fileHistoryBoundaryRule } from './file-history-boundary.mjs';

const declarations = {
  'src/stores/file-history.store.ts': 'export function useFileHistoryStore() {}',
  'src/services/file-history.service.ts': 'export function replayFileChangeSet() {}',
};
test('history publication and replay retain their actual operation owners', () => {
  const context = architectureFixtures({
    ...declarations,
    'src/app/composables/use-history-actions.ts':
      "import {useFileHistoryStore as history} from '@/stores/file-history.store'; import {replayFileChangeSet as replay} from '@/services/file-history.service'; const state=history();\nstate.pushSavedWriteEntry(receipt); state.commitReplayUndo(receipt); replay(receipt);",
    'src/orchestrators/project-sync.orchestrator.ts':
      "import {useFileHistoryStore} from '@/stores/file-history.store'; useFileHistoryStore().pushSavedWriteEntry(receipt);",
    'src/orchestrators/file-history-replay.orchestrator.ts':
      "import {useFileHistoryStore} from '@/stores/file-history.store'; import {replayFileChangeSet} from '@/services/file-history.service'; useFileHistoryStore().commitReplayUndo(receipt); replayFileChangeSet(receipt);",
  });
  const diagnostics = fileHistoryBoundaryRule.check(context);
  assert.equal(diagnostics.length, 3);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.symbol),
    ['pushSavedWriteEntry', 'commitReplayUndo', 'replayFileChangeSet'],
  );
  assert.ok(diagnostics.every((diagnostic) => diagnostic.line === 2));
});
test('local operations with the same spelling keep their local meaning', () => {
  const context = architectureFixtures({
    'src/app/composables/use-history-actions.ts': 'function replayFileChangeSet() {} replayFileChangeSet();',
  });
  assert.deepEqual(fileHistoryBoundaryRule.check(context), []);
});

test('file history cannot invent an empty changeset', () => {
  const context = architectureFixtures({
    'src/app/composables/use-history-actions.ts': 'const changes: FileChangeRecord[] = [];',
  });
  const [diagnostic] = fileHistoryBoundaryRule.check(context);
  assert.equal(diagnostic.ruleId, 'file-history-boundary');
  assert.equal(diagnostic.expected, 'WriteResult.changes');
});

test('file editor replay events belong to the replay orchestrator', () => {
  const context = architectureFixtures({
    'src/windows/tauri.events.ts': 'export function emitWindowEvent() {}',
    'src/orchestrators/example.orchestrator.ts':
      "import {emitWindowEvent} from '@/windows/tauri.events'; emitWindowEvent(WINDOW_EVENTS.fileEditorTextApplied, payload);",
  });
  const [diagnostic] = fileHistoryBoundaryRule.check(context);
  assert.equal(diagnostic.symbol, 'fileEditorTextApplied');
  assert.equal(diagnostic.expected, 'orchestrators/file-history-replay');
});
