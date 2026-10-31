import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../testing/fixtures.mjs';
import { saveBackendBoundaryRule } from './save-backend-boundary.mjs';
import { rustProjectLayerBoundaryRule } from '../dependencies/rust-project-layer-boundary.mjs';
import { parserBoundaryRule } from '../modules/schema/parser-boundary.mjs';
import { projectResourcesBoundaryRule } from '../modules/resources/project-resources-boundary.mjs';
import { rustServiceEdgeBoundaryRule } from '../dependencies/rust-service-edge-boundary.mjs';

const serviceAssembly =
  'pub(crate) use project::query::entities::query_entity; pub(crate) use project::write::entity_identity::save_entity_spec;';

for (const owner of ['entity_description', 'entity_identity', 'csv_patch', 'joint_edit']) {
  test(owner + ' consumes the common CSV draft without a reverse business dependency', () => {
    const files = architectureFixtures({
      ['src-tauri/src/services/project/write/' + owner + '.rs']: 'use super::csv_staging::CsvTableDraft; fn stage() {}',
      'src-tauri/src/services/project/write/csv_staging.rs':
        'use super::super::{cache::csv::read_table_snapshot, model::ProjectSession}; use crate::parsers::render_csv_text;',
    });
    assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(files)), []);
  });
}

for (const source of [
  'type Draft = super::entity_identity::StagedIdentityCsv;',
  'use super::entity_identity::{StagedIdentityCsv as Draft};',
  'use super::entity_identity as identity; fn stage() { identity::save_entity_spec(); }',
  'fn stage() { crate::services::project::write::entity_identity::save_entity_spec(); }',
  'pub use super::entity_identity::StagedIdentityCsv;',
]) {
  test('description rejects reverse identity dependencies: ' + source, () => {
    const files = architectureFixtures({
      'src-tauri/src/services/project/write/entity_description.rs': source,
    });
    const message = messages(rustProjectLayerBoundaryRule.check(files))[0];
    assert.ok(message);
    assert.match(message, /CSV draft and staging/);
  });
}

for (const business of ['entity_description', 'entity_identity', 'csv_patch', 'joint_edit']) {
  for (const source of [
    'use super::' + business + '::{run as save};',
    'fn stage() { crate::services::project::write::' + business + '::run(); }',
  ]) {
    test('CSV staging rejects business dependencies: ' + source, () => {
      const files = architectureFixtures({
        'src-tauri/src/services/project/write/csv_staging.rs': source,
      });
      const message = messages(rustProjectLayerBoundaryRule.check(files))[0];
      assert.ok(message);
      assert.match(message, /CSV draft and staging/);
    });
  }
}

test('test-only identity references keep the CSV production dependency direction', () => {
  const files = architectureFixtures({
    'src-tauri/src/services/project/write/entity_description.rs':
      '#[cfg(test)] mod tests { use super::super::entity_identity::save_entity_spec; }',
  });
  assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(files)), []);
});

for (const source of [
  'crate::services::query_entity();',
  'use crate::services::{query_entity as read}; read();',
  'use crate::services as backend; backend::query_entity();',
]) {
  test('formal business exports retain command and service permissions: ' + source, () => {
    const valid = architectureFixtures({
      'src-tauri/src/services/mod.rs': serviceAssembly,
      'src-tauri/src/commands/example.rs': 'pub fn query() { ' + source + ' }',
      'src-tauri/src/services/file_editor.rs': 'fn load() { ' + source + ' }',
    });
    assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(valid)), []);
    assert.deepEqual(messages(rustServiceEdgeBoundaryRule.check(valid)), []);
    const invalid = architectureFixtures({
      'src-tauri/src/services/mod.rs': serviceAssembly,
      'src-tauri/src/services/app_settings.rs': 'fn load() { ' + source + ' }',
    });
    assert.equal(messages(rustServiceEdgeBoundaryRule.check(invalid)).length, 1);
  });
}
test('session entry rejects business reexports while service assembly connects actual definitions', () => {
  for (const branch of [
    'query::entities::query_entity',
    'write::entity_identity::save_entity_spec',
    'resources::core_graphics::scan_core_graphics',
  ]) {
    const invalid = architectureFixtures({ 'src-tauri/src/services/project/mod.rs': 'pub use self::' + branch + ';' });
    assert.equal(messages(rustProjectLayerBoundaryRule.check(invalid)).length, 1);
  }
  const files = architectureFixtures({ 'src-tauri/src/services/mod.rs': serviceAssembly });
  assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(files)), []);
});
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
test('production permissions exclude test-only imports through formal service exports', () => {
  const files = architectureFixtures({
    'src-tauri/src/services/mod.rs': serviceAssembly,
    'src-tauri/src/services/app_settings.rs': '#[cfg(test)] mod tests { fn query() { crate::services::query_entity(); } }',
  });
  assert.deepEqual(messages(rustServiceEdgeBoundaryRule.check(files)), []);
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

for (const module of [
  'spec_editor',
  'config_entity',
  'json_file',
  'file_editor',
  'file_history',
  'table_save',
  'write_commit',
  'project_session',
  'tables',
  'entity_query',
  'resources',
  'core_assets',
  'schema',
  'directory_opening',
  'workspace_persistence',
  'app_settings',
  'app_log',
  'font',
  'project_identity',
]) {
  test(module + ' request types belong at the command boundary', () => {
    const source = 'use crate::models::' + module + '::SaveExamplePayload; pub fn save() {}';
    const command = architectureFixtures({ 'src-tauri/src/commands/example.rs': source });
    const service = architectureFixtures({ 'src-tauri/src/services/example.rs': source });
    assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(command)), []);
    const message = messages(rustProjectLayerBoundaryRule.check(service))[0];
    assert.ok(message);
    assert.match(message, /command payload models/);
  });
}

for (const module of ['config_entity', 'json_file', 'spec_editor']) {
  test(module + ' consumes the formal parser and leaves resources at their owner', () => {
    const valid = architectureFixtures({
      ['src-tauri/src/services/' + module + '.rs']: 'use crate::parsers::render_csv_text; fn run() { render_csv_text(); }',
    });
    assert.deepEqual(messages(parserBoundaryRule.check(valid)), []);
    const invalid = architectureFixtures({
      ['src-tauri/src/services/' + module + '.rs']: 'use crate::models::ResourceRef; fn run() {}',
    });
    assert.equal(messages(projectResourcesBoundaryRule.check(invalid)).length, 1);
  });
}

test('settings runtime history configuration belongs to lifecycle assembly', () => {
  const source = 'fn apply_settings_runtime() { crate::services::file_history::set_history_limit(20); }';
  const assembly = architectureFixtures({ 'src-tauri/src/commands/app_lifecycle.rs': source });
  assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(assembly)), []);
  const other = architectureFixtures({ 'src-tauri/src/commands/windows.rs': source });
  assert.equal(messages(rustProjectLayerBoundaryRule.check(other)).length, 1);
  const history = architectureFixtures({
    'src-tauri/src/commands/app_lifecycle.rs': 'fn run() { crate::services::file_history::release_history(); }',
  });
  assert.equal(messages(rustProjectLayerBoundaryRule.check(history)).length, 1);
});
