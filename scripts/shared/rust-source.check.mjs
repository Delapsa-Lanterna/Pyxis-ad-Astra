import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productionRustSource } from './rust-source.mjs';
import { cratePaths, rustServiceExports, rustServicePaths } from '../architecture/facts/rust-crate-paths.mjs';
import { architectureFixtures } from '../architecture/testing/fixtures.mjs';

test('external test modules and test reexports preserve subsequent production dependencies', () => {
  for (const item of ['mod tests;', 'pub use tests::fixture;']) {
    const source = `#[cfg(test)] ${item}
      pub use crate::models::{EntityKind, ResourceRef};
      pub fn load() { crate::services::project::query_entity(); }`;
    const production = productionRustSource(source);
    assert.equal(production.includes(item), false);
    const paths = cratePaths(production);
    assert.ok(paths.some((path) => path.join('::') === 'models::EntityKind'));
    assert.ok(paths.some((path) => path.join('::') === 'services::project::query_entity'));
  }
});

test('test function signatures with array lengths and nested bodies leave production functions intact', () => {
  const production = productionRustSource(`
    #[cfg(test)] fn fixture(data: [u8; 4]) { if true { crate::services::hidden(); } }
    pub fn load() { crate::io::read_utf8_no_bom(); }
  `);
  assert.equal(production.includes('hidden'), false);
  assert.ok(cratePaths(production).some((path) => path.join('::') === 'io::read_utf8_no_bom'));
});

test('direct test attributes are excluded while later production references remain visible', () => {
  const source = productionRustSource(
    '#[test] fn fixture() { crate::services::hidden(); }\n#[tokio::test] async fn async_fixture() { crate::services::hidden_again(); }\npub fn load() { let _: &\'static str = "ok"; crate::io::read_utf8_no_bom(); }',
  );
  assert.equal(source.includes('hidden'), false);
  assert.ok(cratePaths(source).some((path) => path.join('::') === 'io::read_utf8_no_bom'));
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

test('raw string delimiters retain complete masking and original offsets', () => {
  const hashes = '#'.repeat(80);
  const source = 'let text=br' + hashes + '"crate::services::hidden();"' + hashes + ';\ncrate::io::read_utf8_no_bom();';
  const production = productionRustSource(source);
  assert.equal(production.length, source.length);
  assert.equal(production.includes('hidden'), false);
  assert.deepEqual(cratePaths(production), [['io', 'read_utf8_no_bom']]);
});
