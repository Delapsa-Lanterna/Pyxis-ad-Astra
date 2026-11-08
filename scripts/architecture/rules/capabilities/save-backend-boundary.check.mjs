import { test } from 'node:test';
import { architectureFixtures, messages } from '../../testing/fixtures.mjs';
import assert from 'node:assert/strict';
import { saveBackendBoundaryRule } from './save-backend-boundary.mjs';

const serviceAssembly =
  'pub(crate) use project::query::entities::query_entity; pub(crate) use project::write::entity_write::content::save_entity_spec;';

test('save commands validate the actual implementation behind a formal service export', () => {
  const files = architectureFixtures({
    'src-tauri/src/services/mod.rs': serviceAssembly,
    'src-tauri/src/commands/example.rs': 'pub fn save_editor_spec() { services::save_entity_spec(); }',
  });
  assert.deepEqual(messages(saveBackendBoundaryRule.check(files)), []);
  const invalid = architectureFixtures({
    'src-tauri/src/services/mod.rs': 'pub use file_editor::save_entity_spec;',
    'src-tauri/src/commands/example.rs': 'pub fn save_mod_info() { services::save_entity_spec(); }',
  });
  assert.equal(messages(saveBackendBoundaryRule.check(invalid)).length, 1);
});

for (const [command, backend] of [
  ['save_project', 'project_save'],
  ['save_editor_spec', 'project'],
  ['load_imported_editor_spec_file', 'spec_editor'],
  ['save_mod_info', 'config_entity'],
  ['save_indexed_config_entity', 'config_entity'],
  ['create_skin_entity', 'json_file'],
  ['save_variant_entity', 'project'],
  ['save_text_file', 'file_editor'],
  ['apply_file_change_set', 'write_transactions'],
  ['save_csv_patch', 'project'],
  ['save_joint_edit', 'project'],
  ['synchronize_committed_write', 'write_transactions'],
]) {
  test(command + ' consumes its business backend and transaction', () => {
    const files = architectureFixtures({
      'src-tauri/src/commands/example.rs':
        'use crate::services; pub fn ' + command + '() { services::write_transactions::begin(); services::' + backend + '::run(); }',
    });
    assert.deepEqual(messages(saveBackendBoundaryRule.check(files)), []);
  });
}

test('each command retains its own backend when several commands share a file', () => {
  const files = architectureFixtures({
    'src-tauri/src/commands/example.rs':
      'use crate::services; pub fn save_mod_info() { services::file_editor::run(); } pub fn save_text_file() { services::file_editor::run(); }',
  });
  const failures = messages(saveBackendBoundaryRule.check(files));
  assert.equal(failures.length, 1);
  assert.ok(failures[0]);
  assert.match(failures[0], /file_editor.*save_mod_info/);
});

test('backend aliases resolve to their actual service owner', () => {
  const files = architectureFixtures({
    'src-tauri/src/commands/example.rs': 'use crate::services::file_editor as files; pub fn save_mod_info() { files::run(); }',
  });
  assert.equal(messages(saveBackendBoundaryRule.check(files)).length, 1);
});

test('test-only consumers do not extend production command permissions', () => {
  const files = architectureFixtures({
    'src-tauri/src/commands/example.rs':
      'use crate::services; pub fn save_mod_info() { services::config_entity::run(); } #[cfg(test)] mod tests { fn replay() { crate::services::file_editor::run(); } }',
  });
  assert.deepEqual(messages(saveBackendBoundaryRule.check(files)), []);
});

test('history commands consume only the history facade', () => {
  for (const command of ['query_file_history', 'clear_file_history']) {
    const allowed = architectureFixtures({
      'src-tauri/src/commands/file_history.rs': 'fn ' + command + '() { crate::services::file_history::' + command + '(session, root); }',
    });
    assert.deepEqual(saveBackendBoundaryRule.check(allowed), []);
    for (const backend of ['project', 'write_transactions']) {
      const denied = architectureFixtures({
        'src-tauri/src/commands/file_history.rs': 'fn ' + command + '() { crate::services::' + backend + '::run(); }',
      });
      assert.equal(saveBackendBoundaryRule.check(denied).length, 1);
    }
  }
});
