import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRustImports } from './check-rust-imports.mjs';

test('Rust paths and local imports report symbols and original positions', () => {
  const text = 'fn inspect() -> crate::models::Catalog {\n    use crate::models::Entry;\n    super::super::catalog::read()\n}';
  const diagnostics = checkRustImports({ path: 'sample.rs', rel: 'sample.rs', text });
  assert.equal(diagnostics.length, 3);
  assert.deepEqual(
    diagnostics.map(({ ruleId, line, column, symbol }) => ({ ruleId, line, column, symbol })),
    [
      { ruleId: 'rust-local-import', line: 2, column: 5, symbol: 'crate::models::Entry' },
      { ruleId: 'rust-inline-path', line: 1, column: 17, symbol: 'crate::models::Catalog' },
      { ruleId: 'rust-inline-path', line: 3, column: 5, symbol: 'super::super::catalog::read' },
    ],
  );
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.file, 'sample.rs');
    assert.equal(diagnostic.reference, '.zcode/backend-guidelines.md#代码组织');
    assert.ok(diagnostic.expected?.includes('module top'));
    assert.equal(diagnostic.source, 'scripts/check-rust-imports.mjs');
  }
});

for (const path of ['std::collections::BTreeMap', 'backend::catalog::read', 'backend::Catalog', 'crate::catalog::read', 'super::Catalog']) {
  test('Rust module paths require imports: ' + path, () => {
    const diagnostics = checkRustImports({ path: 'sample.rs', rel: 'sample.rs', text: `fn inspect() { ${path}; }` });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.symbol, path);
  });
}

test('cross-module references use an explicit top-level import', () => {
  const accepted = 'use crate::catalog; fn inspect() { catalog::read(); }';
  const rejected = 'fn inspect() { crate::catalog::read(); }';
  assert.deepEqual(checkRustImports({ path: 'sample.rs', rel: 'sample.rs', text: accepted }), []);
  assert.deepEqual(
    checkRustImports({ path: 'sample.rs', rel: 'sample.rs', text: rejected }).map(({ ruleId }) => ruleId),
    ['rust-inline-path'],
  );
});

test('Rust module imports preserve aliases, conditions, type associations and macro hygiene', () => {
  const text = [
    '#[cfg(windows)] use std::os::windows::fs::MetadataExt;',
    'use crate::catalog::{Catalog as Records, read};',
    'pub(in crate::catalog) fn inspect() { Records::new(); State::Ready; fs::read(); u16::MAX; f64::NAN; }',
    'mod nested { use super::Records; fn inspect() { Records::new(); } }',
    '#[cfg(test)] mod tests { use super::*; #[test] fn inspect() { Records::new(); } }',
    'macro_rules! scoped { () => { $crate::catalog::read() }; }',
    'fn expand() { quote! { crate::catalog::read(); }; syn::parse_quote!(crate::catalog::Catalog); }',
    'const EXAMPLE: &str = r##"crate::catalog::read()"##;',
    '// crate::catalog::read();',
  ].join('\n');
  assert.deepEqual(checkRustImports({ path: 'sample.rs', rel: 'sample.rs', text }), []);
});

test('Rust tests and closures follow module import rules', () => {
  const text =
    '#[cfg(test)] mod tests { #[test] fn inspect() { let read = || { use crate::catalog::read; read() }; crate::catalog::read(); } }';
  const diagnostics = checkRustImports({ path: 'sample_tests.rs', rel: 'sample_tests.rs', text });
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.ruleId),
    ['rust-local-import', 'rust-inline-path'],
  );
});

test('Rust imports precede definitions in their own module', () => {
  const text = 'mod catalog; use catalog::Entry; struct Owner; use catalog::read; mod nested { struct Owner; use super::Entry; }';
  const diagnostics = checkRustImports({ path: 'sample.rs', rel: 'sample.rs', text });
  assert.deepEqual(
    diagnostics.map((diagnostic) => [diagnostic.ruleId, diagnostic.symbol]),
    [
      ['rust-late-import', 'catalog::read'],
      ['rust-late-import', 'super::Entry'],
    ],
  );
});

test('Rust syntax preserves generic type paths, references and multiline source positions', () => {
  const text = [
    'use crate::catalog as entries;',
    'type Catalog = Vec<entries::Record>;',
    'fn inspect() {',
    '    let read = crate::catalog::read::<u8>;',
    '    matches!(State::Ready, crate::catalog::State::Ready);',
    '}',
  ].join('\n');
  const diagnostics = checkRustImports({ path: 'sample.rs', rel: 'sample.rs', text });
  assert.deepEqual(
    diagnostics.map(({ ruleId, line, column, symbol }) => ({ ruleId, line, column, symbol })),
    [
      { ruleId: 'rust-inline-path', line: 2, column: 20, symbol: 'entries::Record' },
      { ruleId: 'rust-inline-path', line: 4, column: 16, symbol: 'crate::catalog::read' },
      { ruleId: 'rust-inline-path', line: 5, column: 28, symbol: 'crate::catalog::State::Ready' },
    ],
  );
});
