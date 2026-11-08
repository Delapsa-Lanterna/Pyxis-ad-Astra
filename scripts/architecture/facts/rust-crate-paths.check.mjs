import { test } from 'node:test';
import { cratePaths, rustServiceExports, rustServicePaths } from './rust-crate-paths.mjs';
import assert from 'node:assert/strict';
import { architectureFixtures } from '../testing/fixtures.mjs';

test('Rust dependency extraction deduplicates identical resolved references', () => {
  const paths = cratePaths(
    'use crate::models::WriteResult; fn run() { let value: crate::models::WriteResult; }',
    'src-tauri/src/services/sample.rs',
  );
  assert.equal(paths.filter((parts) => parts.join('::') === 'models::WriteResult').length, 1);
});

test('service exports retain actual definitions through grouped imports and local aliases', () => {
  const files = architectureFixtures({
    'src-tauri/src/services/mod.rs':
      'pub(crate) use project::query::entities::{query_entity, query_entity_list}; #[cfg(test)] pub use tests::fixture;',
  });
  const exports = rustServiceExports(files.files);
  assert.equal(exports.size, 2);
  for (const source of [
    'crate::services::query_entity();',
    'use crate::services::{query_entity as read}; read();',
    'use crate::services as backend; backend::query_entity();',
    'use crate::{services as backend}; backend::query_entity();',
  ]) {
    const paths = rustServicePaths(source, 'src-tauri/src/commands/example.rs', exports);
    assert.ok(paths.some((edge) => edge.exported && edge.target.join('::') === 'services::project::query::entities::query_entity'));
  }
  const reference = rustServicePaths('crate::services::project::close_project_session();', '', exports)[0];
  assert.ok(reference);
  assert.deepEqual(reference.target, ['services', 'project', 'close_project_session']);
});
