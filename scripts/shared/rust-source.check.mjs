import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productionRustSource } from './rust-source.mjs';
import { cratePaths } from './rust-crate-paths.mjs';

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
