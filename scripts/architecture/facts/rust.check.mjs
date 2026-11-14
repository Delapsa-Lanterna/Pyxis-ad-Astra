import { test } from 'node:test';
import { productionRustSource } from '../../shared/rust-source.mjs';
import assert from 'node:assert/strict';
import { architectureFixtures, fixtureFile } from '../testing/fixtures.mjs';

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

test('command external names follow macro rename attributes after implementation renames', () => {
  const text = '#[command_macros::command(rename = "save_mod_info")] pub fn replace_settings() {}';
  const file = architectureFixtures({ 'src-tauri/src/commands/settings.rs': text }).rust[0];
  assert.equal(file?.rust.functions[0]?.name, 'replace_settings');
  assert.equal(file?.rust.functions[0]?.commandName, 'save_mod_info');
});

test('native file receiver methods retain constructor origins and source positions', () => {
  const context = architectureFixtures({
    'src-tauri/src/services/sample.rs': 'use std::fs::File; fn run(){ let mut held=File::open("sample"); held.write_all(bytes); }',
  });
  const file = context.rust[0];
  assert.ok(file);
  const call = file.rust.calls.find((call) => call.name === 'write_all');
  assert.equal(call?.target, 'std::fs::File::write_all');
  assert.equal(call?.line, 1);
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

test('Rust module aliases and function values retain their resolved service path', () => {
  const files = architectureFixtures({
    'src-tauri/src/services/mod.rs': 'pub(crate) use project::query::query_entity;',
    'src-tauri/src/services/example.rs':
      'use crate::services::project::query as query_layer; fn run() { let action = query_layer::query_entity; action(); }',
  });
  const file = fixtureFile(files, (item) => item.rel === 'src-tauri/src/services/example.rs');
  assert.equal(
    file.rust.references.some((edge) => edge.target.join('::').includes('project::query')),
    true,
  );
});

test('Rust call literals use masked argument boundaries and preserve source positions', () => {
  const context = architectureFixtures({
    'src-tauri/build.rs': 'fn main(){bundle_schemas("../schemas/csv", r#"csv_schemas.rs"#);other("a,b", target);}',
  });
  const file = context.byPath.get('src-tauri/build.rs');
  const call = file?.rust.calls.find((call) => call.name === 'bundle_schemas');
  assert.deepEqual(call?.literals, ['../schemas/csv', 'csv_schemas.rs']);
  assert.equal(call?.line, 1);
  assert.deepEqual(file?.rust.calls.find((call) => call.name === 'other')?.literals, ['a,b', null]);
});
