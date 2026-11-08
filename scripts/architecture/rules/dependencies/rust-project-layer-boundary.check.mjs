import { test } from 'node:test';
import { architectureFixtures, messages } from '../../testing/fixtures.mjs';
import assert from 'node:assert/strict';
import { rustProjectLayerBoundaryRule } from './rust-project-layer-boundary.mjs';

const serviceAssembly =
  'pub(crate) use project::query::entities::query_entity; pub(crate) use project::write::entity_write::content::save_entity_spec;';

test('JSON value operations form a shared leaf below business layers', () => {
  for (const consumer of ['src-tauri/src/services/misc_config.rs', 'src-tauri/src/services/project/query/resources.rs']) {
    const context = architectureFixtures({ [consumer]: 'fn overlay() { crate::json_overlay::overlay_json_value(target, incoming); }' });
    assert.deepEqual(rustProjectLayerBoundaryRule.check(context), []);
  }
  for (const target of [
    'crate::domain::schema::validate_field',
    'crate::services::misc_config::save_misc_config',
    'crate::io::read_json_file',
  ]) {
    const context = architectureFixtures({ 'src-tauri/src/json_overlay.rs': '\nfn overlay() { ' + target + '(value); }' });
    const diagnostics = rustProjectLayerBoundaryRule.check(context);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.file, 'src-tauri/src/json_overlay.rs');
    assert.equal(diagnostics[0]?.line, 2);
    assert.equal(diagnostics[0]?.target, target);
  }
});

test('project consumers access sessions while lifecycle remains owned by session management', () => {
  for (const layer of ['query', 'write', 'resources']) {
    const source = 'src-tauri/src/services/project/' + layer + '/sample.rs';
    const allowed = architectureFixtures({ [source]: 'fn run() { crate::services::project::session::lock_ready_session(handle); }' });
    assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(allowed)), []);
    const denied = architectureFixtures({ [source]: 'fn run() { crate::services::project::session::close_project_session(id); }' });
    assert.equal(messages(rustProjectLayerBoundaryRule.check(denied)).length, 1);
  }
});

test('application data directory capabilities are consumed by services', () => {
  const service = architectureFixtures({ 'src-tauri/src/services/example.rs': 'fn run() { crate::app_data_dir::data_directory(app); }' });
  assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(service)), []);
  for (const layer of ['domain', 'io', 'models', 'parsers']) {
    const context = architectureFixtures({
      ['src-tauri/src/' + layer + '/sample.rs']: 'fn run() { crate::app_data_dir::data_directory(app); }',
    });
    assert.equal(messages(rustProjectLayerBoundaryRule.check(context)).length, 1);
  }
});

test('source roots keep path authorization within the source owner', () => {
  const allowed = architectureFixtures({
    'src-tauri/src/services/project/sources/roots.rs': 'fn resolve() { crate::io::FsRootBoundary::new(root, "source root"); }',
  });
  assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(allowed)), []);
  const denied = architectureFixtures({
    'src-tauri/src/services/project/sources/mod.rs':
      '\nfn resolve() { crate::services::directory_opening::resolve_game_mods_directory(root); }',
  });
  const diagnostics = rustProjectLayerBoundaryRule.check(denied);
  assert.equal(diagnostics.length, 1);
  const diagnostic = diagnostics[0];
  assert.ok(diagnostic);
  assert.equal(diagnostic.file, 'src-tauri/src/services/project/sources/mod.rs');
  assert.equal(diagnostic.line, 2);
  assert.equal(diagnostic.target, 'crate::services::directory_opening::resolve_game_mods_directory');
});

test('source products are consumed by session models while source reads stay independent', () => {
  const allowed = architectureFixtures({
    'src-tauri/src/services/project/model.rs': 'use crate::services::project::sources::documents::LoadedSpecRecord;',
  });
  assert.deepEqual(rustProjectLayerBoundaryRule.check(allowed), []);
  for (const target of ['crate::services::project::model::ProjectSession', 'crate::domain::schema::validate_field']) {
    const denied = architectureFixtures({ 'src-tauri/src/services/project/sources/core.rs': '\nfn read() { ' + target + '(); }' });
    const [diagnostic] = rustProjectLayerBoundaryRule.check(denied);
    assert.ok(diagnostic);
    assert.equal(diagnostic.line, 2);
  }
});

test('project definitions consume projection capture while session lifecycle stays owned', () => {
  const file = 'src-tauri/src/services/project/definitions/entity_definitions.rs';
  const allowed = architectureFixtures({
    [file]: 'fn read() { crate::services::project::session::source_versions::capture_changed_versions(sources, paths); }',
  });
  assert.deepEqual(rustProjectLayerBoundaryRule.check(allowed), []);
  const denied = architectureFixtures({ [file]: '\nfn read() { crate::services::project::session::lock_registry(); }' });
  const [diagnostic] = rustProjectLayerBoundaryRule.check(denied);
  assert.ok(diagnostic);
  assert.equal(diagnostic.line, 2);
});

test('entity preparation and formal table state keep CSV editor consumption one-way', () => {
  for (const consumer of ['write/entity_write/associated_specs.rs', 'session/csv_tables.rs', 'model.rs', 'invalidation.rs']) {
    for (const target of [
      'query::csv_associated_specs::verify_file',
      'query::csv_window::query_csv_table_rows',
      'write::csv_patch::save_csv_patch_snapshot',
      'definitions::table_definitions::csv_table_definition',
    ]) {
      const file = 'src-tauri/src/services/project/' + consumer;
      const context = architectureFixtures({ [file]: '\nfn run() { crate::services::project::' + target + '(); }' });
      const diagnostics = rustProjectLayerBoundaryRule
        .check(context)
        .filter((item) => item.message.includes('entity writes and formal table state'));
      assert.equal(diagnostics.length, 1);
      assert.equal(diagnostics[0]?.file, file);
      assert.equal(diagnostics[0]?.line, 2);
    }
  }
  for (const [consumer, target] of [
    ['write/entity_write/associated_spec_preparation.rs', 'query::entity_targets::describe_entity_target'],
    ['write/entity_write/associated_specs.rs', 'write::entity_write::associated_spec_preparation::verify_associated_spec_file'],
    ['session/csv_tables.rs', 'model::csv_table_specs'],
    ['query/source_catalog/values.rs', 'resources::table_references::csv_source_resource_ref'],
  ]) {
    const context = architectureFixtures({
      ['src-tauri/src/services/project/' + consumer]: 'fn run() { crate::services::project::' + target + '(); }',
    });
    assert.deepEqual(rustProjectLayerBoundaryRule.check(context), []);
  }
});

test('source catalog queries consume session facts one-way', () => {
  for (const leaf of ['values', 'images', 'config_sources']) {
    const target = 'crate::services::project::query::source_catalog::' + leaf + '::read';
    for (const source of ['session/csv_tables.rs', 'invalidation.rs', 'definitions/entity_definitions.rs']) {
      const context = architectureFixtures({ ['src-tauri/src/services/project/' + source]: 'fn run() { ' + target + '(); }' });
      assert.equal(rustProjectLayerBoundaryRule.check(context).length, 1);
    }
  }
});

test('formal content stays below resource products while lifecycle owns media configuration and release', () => {
  const target = 'crate::services::project::resources::entity_references::entity_resource_refs';
  for (const source of ['definitions/entity_definitions.rs', 'model.rs', 'session.rs', 'query/json_layers.rs']) {
    const files = architectureFixtures({ ['src-tauri/src/services/project/' + source]: 'fn run() { ' + target + '(); }' });
    assert.ok(rustProjectLayerBoundaryRule.check(files).some((item) => item.message.includes('formal project content')));
  }
  for (const [source, capability] of [
    ['app_lifecycle', 'configure_media_cache'],
    ['project_sync', 'clear_session_media'],
  ]) {
    const files = architectureFixtures({
      ['src-tauri/src/services/' + source + '.rs']: 'fn run() { crate::services::project::resources::media_cache::' + capability + '(); }',
    });
    assert.deepEqual(rustProjectLayerBoundaryRule.check(files), []);
  }
});

for (const owner of ['entity_write/descriptions', 'entity_write/content', 'csv_patch', 'joint_edit']) {
  test(owner + ' consumes the common CSV draft without a reverse business dependency', () => {
    const files = architectureFixtures({
      ['src-tauri/src/services/project/write/' + owner + '.rs']:
        'use crate::services::project::session::csv_writes::CsvTableDraft; fn stage() {}',
      'src-tauri/src/services/project/session/csv_writes.rs':
        'use super::super::{cache::csv::read_table_snapshot, model::ProjectSession}; use crate::parsers::render_csv_text;',
    });
    assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(files)), []);
  });
}

for (const source of [
  'type Draft = super::content::StagedEntityWrite;',
  'use super::content::{StagedEntityWrite as Draft};',
  'use super::content as identity; fn stage() { identity::save_entity_spec(); }',
  'fn stage() { crate::services::project::write::entity_write::content::save_entity_spec(); }',
  'pub use super::content::StagedEntityWrite;',
]) {
  test('description rejects reverse identity dependencies: ' + source, () => {
    const files = architectureFixtures({
      'src-tauri/src/services/project/write/entity_write/descriptions.rs': source,
    });
    const message = messages(rustProjectLayerBoundaryRule.check(files))[0];
    assert.ok(message);
    assert.match(message, /CSV draft and staging/);
  });
}

for (const business of ['entity_write/descriptions', 'entity_write/content', 'csv_patch', 'joint_edit']) {
  for (const source of [
    'use crate::services::project::write::' + business.replaceAll('/', '::') + '::{run as save};',
    'fn stage() { crate::services::project::write::' + business.replaceAll('/', '::') + '::run(); }',
  ]) {
    test('CSV staging rejects business dependencies: ' + source, () => {
      const files = architectureFixtures({
        'src-tauri/src/services/project/session/csv_writes.rs': source,
      });
      const failures = messages(rustProjectLayerBoundaryRule.check(files));
      assert.ok(failures.some((message) => /CSV draft and staging/.test(message)));
    });
  }
}

test('test-only identity references keep the CSV production dependency direction', () => {
  const files = architectureFixtures({
    'src-tauri/src/services/project/write/entity_write/descriptions.rs':
      '#[cfg(test)] mod tests { use super::super::content::save_entity_spec; }',
  });
  assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(files)), []);
});

test('session entry rejects business reexports while service assembly connects actual definitions', () => {
  for (const branch of [
    'query::entities::query_entity',
    'write::entity_write::content::save_entity_spec',
    'resources::core_graphics::scan_core_graphics',
  ]) {
    const invalid = architectureFixtures({ 'src-tauri/src/services/project/mod.rs': 'pub use self::' + branch + ';' });
    assert.equal(messages(rustProjectLayerBoundaryRule.check(invalid)).length, 1);
  }
  const files = architectureFixtures({ 'src-tauri/src/services/mod.rs': serviceAssembly });
  assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(files)), []);
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

test('source reading consumes IO and source-owned record types', () => {
  const files = architectureFixtures({
    'src-tauri/src/services/project/sources/mod.rs':
      'fn read() { crate::io::read_versioned_json(); crate::services::project::sources::documents::LoadedSpecRecord; }',
  });
  assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(files)), []);
});

test('queries, table caches and resources consume source capabilities', () => {
  for (const role of ['query', 'cache', 'resources']) {
    const files = architectureFixtures({
      [`src-tauri/src/services/project/${role}/reader.rs`]:
        'fn read() { crate::services::project::sources::core::load_core_ship_files(); }',
    });
    assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(files)), []);
  }
});

test('source reading keeps transaction and query actions at their owners', () => {
  for (const role of ['write', 'query']) {
    const files = architectureFixtures({
      'src-tauri/src/services/project/sources/mod.rs': `fn read() { crate::services::project::${role}::run(); }`,
    });
    assert.match(messages(rustProjectLayerBoundaryRule.check(files)).join('\n'), /project-sources must not depend/);
  }
});
