import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../testing/fixtures.mjs';

import { rustServiceEdgeBoundaryRule } from './rust-service-edge-boundary.mjs';
import { rustProjectLayerBoundaryRule } from './rust-project-layer-boundary.mjs';

test('source root resolution consumes directory authorization', () => {
  const allowed = architectureFixtures({
    'src-tauri/src/services/project/sources/mod.rs':
      'fn resolve() { crate::services::directory_opening::resolve_game_mods_directory(root); }',
  });
  assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(allowed)), []);
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
