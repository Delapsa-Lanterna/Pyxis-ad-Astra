import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { workspaceHistoryBoundaryRule } from './workspace-history-boundary.mjs';

test('shortcuts consume command parsing and dispatch without owning history stores', () => {
  const legal = architectureFixtures({
    'src/app/composables/use-main-window-shortcuts.ts':
      "import {dispatchWorkspaceHistoryCommand} from '@/orchestrators/workspace-history.orchestrator';",
    'src/orchestrators/workspace-history.orchestrator.ts': 'export function dispatchWorkspaceHistoryCommand() {}',
  });
  assert.deepEqual(workspaceHistoryBoundaryRule.check(legal), []);
  const invalid = architectureFixtures({
    'src/app/composables/use-main-window-shortcuts.ts': "\nimport {useFileHistoryStore} from '@/stores/file-history.store';",
    'src/stores/file-history.store.ts': 'export function useFileHistoryStore() {}',
  });
  const [diagnostic] = workspaceHistoryBoundaryRule.check(invalid);
  assert.ok(diagnostic);
  assert.equal(diagnostic.ruleId, 'workspace-history-boundary');
  assert.equal(diagnostic.line, 2);
  assert.equal(diagnostic.target, 'src/stores/file-history.store.ts');
  assert.equal(diagnostic.expected, 'history dispatcher');
});
test('keyboard details and Vue lifecycle stay at their respective callers', () => {
  const context = architectureFixtures({
    'src/app/composables/use-main-window-shortcuts.ts': '\nfunction press(event){ return event.ctrlKey; }',
    'src/orchestrators/workspace-history.orchestrator.ts': "\nimport {onMounted} from 'vue';",
  });
  const diagnostics = workspaceHistoryBoundaryRule.check(context);
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every(({ line }) => line === 2));
});
