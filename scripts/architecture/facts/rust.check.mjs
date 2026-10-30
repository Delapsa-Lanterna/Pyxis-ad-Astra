import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../testing/fixtures.mjs';
import { productionRustSource } from '../../shared/rust-source.mjs';

test('Rust masking preserves offsets through nested comments, raw strings, chars and test items', () => {
  const text =
    "/* outer /* nested */ end */\nconst RAW: &str = r##\"{ crate::services::hidden() }\"##;\nconst QUOTE: char = '\"';\n#[cfg(test)] mod tests { fn run() { crate::services::hidden(); } }\nfn read<'life>(value: &'life str) { crate::io::read_utf8_no_bom(); }\n";
  const code = productionRustSource(text);
  assert.equal(code.length, text.length);
  assert.deepEqual(
    [...code.matchAll(/\n/g)].map((match) => match.index),
    [...text.matchAll(/\n/g)].map((match) => match.index),
  );
  assert.equal(code.includes('hidden'), false);
  const file = architectureFixtures({ 'src-tauri/src/services/sample.rs': text }).rust[0];
  assert.ok(file);
  const edge = file.rust.references.find((edge) => edge.target.join('::') === 'io::read_utf8_no_bom');
  assert.ok(edge);
  assert.equal(edge.line, 5);
  assert.equal(edge.column, 37);
  const fn = file.rust.functions[0];
  assert.ok(fn);
  assert.equal(fn.name, 'read');
});
test('Rust module and local aliases retain lexical scopes and service definitions', () => {
  const context = architectureFixtures({
    'src-tauri/src/services/mod.rs': 'pub(crate) use project::query::entities::query_entity as read;',
    'src-tauri/src/services/sample.rs':
      'use crate::services as backend;\nfn first(){ use crate::io as backend; backend::read_utf8_no_bom(); }\nfn second(){ backend::read(); }\nmod inner { fn read(){ super::super::project::model::Value; } }',
  });
  const file = context.byPath.get('src-tauri/src/services/sample.rs');
  assert.ok(file);
  assert.ok(file.rust.references.some((edge) => edge.line === 2 && edge.target.join('::') === 'io::read_utf8_no_bom'));
  assert.ok(
    file.rust.references.some(
      (edge) => edge.line === 3 && edge.exported && edge.target.join('::') === 'services::project::query::entities::query_entity',
    ),
  );
  assert.ok(file.rust.references.some((edge) => edge.line === 4 && edge.target.join('::') === 'services::project::model::Value'));
});
