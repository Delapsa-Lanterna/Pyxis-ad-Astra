import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { workspacePersistenceBoundaryRule } from './workspace-persistence-boundary.mjs';

for (const command of ['load_workspace', 'save_workspace'])
  test(command + ' retains its actual persistence route', () => {
    const valid = architectureFixtures({
      'src-tauri/src/commands/sample.rs':
        'use crate::services::workspace_persistence as persistence;\npub fn ' + command + '() { persistence::run(); }',
    });
    assert.deepEqual(workspacePersistenceBoundaryRule.check(valid), []);
    const invalid = architectureFixtures({
      'src-tauri/src/commands/sample.rs': 'use crate::services::app_settings as settings;\npub fn ' + command + '() { settings::run(); }',
    });
    const diagnostics = workspacePersistenceBoundaryRule.check(invalid);
    assert.equal(diagnostics.length, 1);
    assert.ok(diagnostics[0]);
    assert.equal(diagnostics[0].ruleId, 'workspace-persistence-boundary');
    assert.equal(diagnostics[0].line, 2);
    assert.equal(diagnostics[0].expected, 'services::workspace_persistence');
  });

test('workspace persistence ownership follows the external command name', () => {
  const context = architectureFixtures({
    'src-tauri/src/commands/workspace.rs':
      '#[command_macros::command(rename = "load_workspace")] pub fn load_snapshot() { crate::services::app_settings::run(); }',
  });
  const [diagnostic] = workspacePersistenceBoundaryRule.check(context);
  assert.ok(diagnostic);
  assert.equal(diagnostic.expected, 'services::workspace_persistence');
});
