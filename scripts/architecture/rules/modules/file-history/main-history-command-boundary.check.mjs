import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { mainHistoryCommandBoundaryRule } from './main-history-command-boundary.mjs';

test('shortcuts consume command parsing and dispatch without owning history stores', () => {
  const legal = architectureFixtures({
    'src/app/composables/use-main-window-shortcuts.ts':
      "import {dispatchMainUndoCommand} from '@/orchestrators/main-history-command.orchestrator';",
    'src/orchestrators/main-history-command.orchestrator.ts': 'export function dispatchMainUndoCommand() {}',
  });
  assert.deepEqual(mainHistoryCommandBoundaryRule.check(legal), []);
  const invalid = architectureFixtures({
    'src/app/composables/use-main-window-shortcuts.ts': "\nimport {useFileHistoryStore} from '@/stores/file-history.store';",
    'src/stores/file-history.store.ts': 'export function useFileHistoryStore() {}',
  });
  const [diagnostic] = mainHistoryCommandBoundaryRule.check(invalid);
  assert.ok(diagnostic);
  assert.equal(diagnostic.ruleId, 'main-history-command-boundary');
  assert.equal(diagnostic.line, 2);
  assert.equal(diagnostic.target, 'src/stores/file-history.store.ts');
  assert.equal(diagnostic.expected, 'history dispatcher');
});
test('keyboard details and Vue lifecycle stay at their respective callers', () => {
  const context = architectureFixtures({
    'src/app/composables/use-main-window-shortcuts.ts': '\nfunction press(event){ return event.ctrlKey; }',
    'src/orchestrators/main-history-command.orchestrator.ts': "\nimport {onMounted} from 'vue';",
  });
  const diagnostics = mainHistoryCommandBoundaryRule.check(context);
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every(({ line }) => line === 2));
});
