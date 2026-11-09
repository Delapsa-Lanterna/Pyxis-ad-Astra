import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { fileHistoryBoundaryRule } from './file-history-boundary.mjs';

const declarations = {
  'src/stores/file-history.store.ts': 'export function useFileHistoryStore() {}',
  'src/services/file-history.service.ts': 'export function replayFileChangeSet() {}',
};

test('history snapshots retain their actual consumer owners', () => {
  const legal = architectureFixtures({
    ...declarations,
    'src/orchestrators/project-sync.orchestrator.ts':
      "import {useFileHistoryStore} from '@/stores/file-history.store'; useFileHistoryStore().applySnapshot(root, snapshot);",
    'src/orchestrators/file-history-replay.orchestrator.ts':
      "import {useFileHistoryStore} from '@/stores/file-history.store'; useFileHistoryStore().applySnapshot(root, snapshot);",
    'src/app/composables/use-workspace-file-history-view-model.ts':
      "import {useFileHistoryStore} from '@/stores/file-history.store'; useFileHistoryStore().applySnapshot(root, snapshot);",
  });
  assert.deepEqual(fileHistoryBoundaryRule.check(legal), []);

  const invalid = architectureFixtures({
    ...declarations,
    'src/app/composables/use-history-actions.ts':
      "import {useFileHistoryStore} from '@/stores/file-history.store'; useFileHistoryStore().applySnapshot(root, snapshot);",
  });
  const [diagnostic] = fileHistoryBoundaryRule.check(invalid);
  assert.ok(diagnostic);
  assert.equal(diagnostic.symbol, 'applySnapshot');
  assert.ok(diagnostic.expected);
  assert.match(diagnostic.expected, /file-history-view-model/);
});

test('replay remains owned by the replay orchestrator', () => {
  const legal = architectureFixtures({
    ...declarations,
    'src/orchestrators/file-history-replay.orchestrator.ts':
      "import {replayFileChangeSet} from '@/services/file-history.service'; replayFileChangeSet(root);",
  });
  assert.deepEqual(fileHistoryBoundaryRule.check(legal), []);

  const invalid = architectureFixtures({
    ...declarations,
    'src/app/composables/use-history-actions.ts':
      "import {replayFileChangeSet} from '@/services/file-history.service'; replayFileChangeSet(root);",
  });
  const [diagnostic] = fileHistoryBoundaryRule.check(invalid);
  assert.ok(diagnostic);
  assert.equal(diagnostic.symbol, 'replayFileChangeSet');
});

test('file history cannot invent an empty changeset', () => {
  const context = architectureFixtures({
    'src/shared/types/file-changes.types.ts': 'export interface FileChangeRecord { kind: string }',
    'src/app/composables/use-history-actions.ts':
      'import type { FileChangeRecord as Change } from "@/shared/types/file-changes.types"; const changes: Change[] = [];',
  });
  const [diagnostic] = fileHistoryBoundaryRule.check(context);
  assert.ok(diagnostic);
  assert.equal(diagnostic.expected, 'WriteResult.changes');
});

test('unrelated local change records retain their own type identity', () => {
  const context = architectureFixtures({
    'src/app/composables/use-history-actions.ts': 'interface FileChangeRecord { note: string } const changes: FileChangeRecord[] = [];',
  });
  assert.deepEqual(fileHistoryBoundaryRule.check(context), []);
});

test('local snapshot functions retain their local meaning', () => {
  const context = architectureFixtures({ 'src/app/composables/use-history-actions.ts': 'function applySnapshot() {} applySnapshot();' });
  assert.deepEqual(fileHistoryBoundaryRule.check(context), []);
});

test('empty arrays retain aliased formal changeset types', () => {
  const context = architectureFixtures({
    'src/shared/types/file-changes.types.ts': 'export interface FileChangeRecord {}',
    'src/app/composables/use-history-actions.ts':
      'import type {FileChangeRecord as Change} from "@/shared/types/file-changes.types"; const changes: Array<Change> = [];',
  });
  const [diagnostic] = fileHistoryBoundaryRule.check(context);
  assert.ok(diagnostic);
  assert.equal(diagnostic.expected, 'WriteResult.changes');
});
