import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../testing/fixtures.mjs';

import { rustServiceEdgeBoundaryRule } from './rust-service-edge-boundary.mjs';
import { rustProjectLayerBoundaryRule } from './rust-project-layer-boundary.mjs';

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

test('Rust module and layer restrictions report each dependency fact once', () => {
  const horizontal = architectureFixtures({
    'src-tauri/src/services/example.rs': 'use crate::services::app_log::{first, second}; fn run() { crate::services::app_log::first(); }',
  });
  assert.equal(messages(rustServiceEdgeBoundaryRule.check(horizontal)).length, 1);
  const layers = architectureFixtures({
    'src-tauri/src/models/example.rs': 'use crate::services::app_log::{first, second}; fn run() { crate::services::app_log::first(); }',
  });
  assert.equal(messages(rustProjectLayerBoundaryRule.check(layers)).length, 1);
});

test('Rust public query names retain their facade ownership and internal query modules retain their layer', () => {
  const facade = architectureFixtures({
    'src-tauri/src/services/file_editor.rs': 'fn run() { crate::services::project::query_entity_identity_intent(); }',
  });
  assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(facade)), []);
  assert.deepEqual(messages(rustServiceEdgeBoundaryRule.check(facade)), []);
  const internal = architectureFixtures({
    'src-tauri/src/services/file_editor.rs': 'fn run() { crate::services::project::query::identity(); }',
  });
  assert.equal(messages(rustProjectLayerBoundaryRule.check(internal)).length, 1);
});

test('project query and write layers reject standard file mutation and session opening', () => {
  const query = architectureFixtures({
    'src-tauri/src/services/project/query/sample.rs': 'pub fn query() { std::fs::remove_file("item"); }',
  });
  const write = architectureFixtures({
    'src-tauri/src/services/project/write/sample.rs': 'pub fn save() { crate::services::project::open_project_session_traced(); }',
  });
  assert.equal(messages(rustProjectLayerBoundaryRule.check(query)).length, 1);
  assert.equal(messages(rustProjectLayerBoundaryRule.check(write)).length, 1);
});

test('project cache and service signatures keep their ownership boundaries', () => {
  const cache = architectureFixtures({
    'src-tauri/src/services/project/cache/sample.rs':
      'use crate::services::project::sources::core::load_all_core; pub fn run() { load_all_core(); }',
  });
  const service = architectureFixtures({
    'src-tauri/src/services/sample.rs': 'pub fn run(payload: SamplePayload) {}',
  });
  assert.equal(messages(rustProjectLayerBoundaryRule.check(cache)).length, 1);
  assert.equal(messages(rustProjectLayerBoundaryRule.check(service)).length, 1);
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

test('history scope authorization belongs to its facade while records remain independent', () => {
  const target = 'crate::services::project::ensure_project_session_mod_root';
  const facade = architectureFixtures({ 'src-tauri/src/services/file_history.rs': 'fn read() { ' + target + '(session, root); }' });
  assert.deepEqual(rustProjectLayerBoundaryRule.check(facade), []);
  assert.deepEqual(rustServiceEdgeBoundaryRule.check(facade), []);
  const records = architectureFixtures({
    'src-tauri/src/services/file_history/records.rs': 'fn read() { ' + target + '(session, root); }',
  });
  assert.equal(rustProjectLayerBoundaryRule.check(records).length, 1);
  assert.equal(rustServiceEdgeBoundaryRule.check(records).length, 1);
  for (const target of ['unregister_project_session', 'resources::media_cache::clear_session_media']) {
    const allowed = architectureFixtures({
      'src-tauri/src/services/project_sync.rs': 'fn release() { crate::services::project::' + target + '(id); }',
    });
    assert.deepEqual(rustProjectLayerBoundaryRule.check(allowed), []);
    const denied = architectureFixtures({
      'src-tauri/src/services/file_editor.rs': 'fn release() { crate::services::project::' + target + '(id); }',
    });
    assert.equal(rustProjectLayerBoundaryRule.check(denied).length, 1);
  }
  const session = architectureFixtures({
    'src-tauri/src/services/project/session.rs': 'fn release() { crate::services::file_history::release_root_history(root); }',
  });
  assert.equal(rustProjectLayerBoundaryRule.check(session).length, 1);
});

test('source catalog queries retain read-only layers and consume session facts one-way', () => {
  for (const leaf of ['values', 'images', 'config_sources']) {
    const target = 'crate::services::project::query::source_catalog::' + leaf + '::read';
    for (const source of ['session/csv_tables.rs', 'invalidation.rs', 'definitions/entity_definitions.rs']) {
      const context = architectureFixtures({ ['src-tauri/src/services/project/' + source]: 'fn run() { ' + target + '(); }' });
      assert.equal(rustProjectLayerBoundaryRule.check(context).length, 1);
    }
    const query = 'src-tauri/src/services/project/query/source_catalog/' + leaf + '.rs';
    assert.equal(
      rustProjectLayerBoundaryRule.check(architectureFixtures({ [query]: 'fn run() { std::fs::write(path, bytes); }' })).length,
      1,
    );
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
