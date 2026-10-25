import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { workspaceModuleBoundaryRule } from './workspace-module-boundary.mjs';

const workspace = 'src/stores/workspace.store.ts';
const provider = { [workspace]: 'export function useWorkspaceStore() {}' };
const activate = "import {useWorkspaceStore as open} from '@/stores/workspace.store'; const state=open();\nstate.activateModTable(target);";
test('workspace activation is delegated through the navigation owner', () => {
  const invalid = architectureFixtures({
    ...provider,
    'src/app/components/csv-editor/Surface.vue': '<script setup>\n' + activate + '</script>',
  });
  const [diagnostic] = workspaceModuleBoundaryRule.check(invalid);
  assert.equal(diagnostic.ruleId, 'workspace-module-boundary');
  assert.equal(diagnostic.line, 3);
  assert.equal(diagnostic.symbol, 'activateModTable');
  for (const rel of ['src/orchestrators/workspace-navigation.orchestrator.ts', 'src/app/components/csv-editor/input.spec.ts'])
    assert.deepEqual(workspaceModuleBoundaryRule.check(architectureFixtures({ ...provider, [rel]: activate })), []);
});
test('workspace assignments follow their actual receiver', () => {
  const source =
    "import {useWorkspaceStore} from '@/stores/workspace.store'; const state=useWorkspaceStore(); const local={currentView:'sample'};\nlocal.currentView='other'; const empty=!state.activeModRoot;\nstate.currentView='other';";
  const diagnostics = workspaceModuleBoundaryRule.check(architectureFixtures({ ...provider, 'src/app/composables/use-sample.ts': source }));
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].line, 3);
  assert.equal(diagnostics[0].symbol, 'currentView');
});
