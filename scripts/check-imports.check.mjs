import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkInlineTypeImports, checkRustImports } from './check-imports.mjs';
import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { TestWorkspace } from './shared/test-workspace.mjs';

for (const rel of ['src/domain/sample.ts', 'src/app/Sample.vue', 'src/test/sample.spec.ts', 'scripts/sample.ts']) {
  test('inline type imports report their exact source position in ' + rel, () => {
    const body = "type A = import('module').Value;\ntype B = typeof import('module');";
    const text = rel.endsWith('.vue') ? '<template><div /></template>\n<script setup lang="ts">\n' + body + '\n</script>' : '\n' + body;
    const diagnostics = checkInlineTypeImports({ path: rel, rel, text });
    assert.equal(diagnostics.length, 2);
    for (const [index, diagnostic] of diagnostics.entries()) {
      assert.equal(diagnostic.ruleId, 'inline-type-import');
      assert.equal(diagnostic.file, rel);
      assert.equal(diagnostic.line, (rel.endsWith('.vue') ? 3 : 2) + index);
      assert.equal(diagnostic.column, 10);
      assert.equal(diagnostic.expected, 'top-level import type');
      assert.equal(diagnostic.symbol, index ? "typeof import('module')" : "import('module').Value");
    }
  });
}

test('type imports nested in generics, queries, conditional types and declarations are checked', () => {
  const text = [
    "type A = Promise<import('module').Value[]>;",
    "type B = ReturnType<typeof import('module').create>;",
    "type C<T> = T extends import('module').Value ? import('module').Other : never;",
    "declare function load(): import('module').Value;",
  ].join('\n');
  assert.equal(checkInlineTypeImports({ path: 'sample.d.ts', rel: 'sample.d.ts', text }).length, 5);
});

test('top-level type imports, runtime imports, JSDoc and diagnostic samples retain their meanings', () => {
  const text = [
    "import type { Value } from 'module';",
    "import type * as Module from 'module';",
    'type A = Promise<Value[]>; type B = typeof Module;',
    "/** @param {import('module').Value} value */",
    "export async function load(value: Value) { return import('module'); }",
    'const example = "type A = import(\'module\').Value";',
    "// type A = import('module').Value;",
  ].join('\n');
  assert.deepEqual(checkInlineTypeImports({ path: 'sample.ts', rel: 'sample.ts', text }), []);
  assert.deepEqual(
    checkInlineTypeImports({ path: 'sample.mjs', rel: 'sample.mjs', text: "/** @type {import('module').Value} */ const value = {};" }),
    [],
  );
});

test('the executable rejects inline types and accepts JSDoc after the source is corrected', async () => {
  const root = await TestWorkspace.create(tmpdir(), 'pyxis-import-check');
  const command = fileURLToPath(new URL('./check-imports.mjs', import.meta.url));
  try {
    await writeFile(root.path('sample.spec.ts'), "type Value = import('module').Value;", 'utf8');
    await writeFile(root.path('script.mjs'), "/** @type {import('module').Value} */ const value = {};", 'utf8');
    const invalid = spawnSync(process.execPath, [command], { cwd: root.root, encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /sample.spec.ts:1:14: \[inline-type-import\]/);
    await writeFile(root.path('sample.spec.ts'), "import type { Value } from 'module';", 'utf8');
    const valid = spawnSync(process.execPath, [command], { cwd: root.root, encoding: 'utf8' });
    assert.equal(valid.status, 0);
    assert.match(valid.stdout, /Import check passed/);
  } finally {
    await root.close();
  }
});

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
  }
});

for (const path of ['std::collections::BTreeMap', 'backend::catalog::read', 'backend::Catalog', 'crate::catalog::read', 'super::Catalog']) {
  test('Rust module paths require imports: ' + path, () => {
    const diagnostics = checkRustImports({ path: 'sample.rs', rel: 'sample.rs', text: `fn inspect() { ${path}; }` });
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.symbol, path);
  });
}

test('Rust module imports preserve aliases, conditions, type associations and macro hygiene', () => {
  const text = [
    '#[cfg(windows)] use std::os::windows::fs::MetadataExt;',
    'use crate::catalog::{Catalog as Records, read};',
    'pub(in crate::catalog) fn inspect() { Records::new(); State::Ready; fs::read(); u16::MAX; f64::NAN; }',
    'mod nested { use super::Records; fn inspect() { Records::new(); } }',
    '#[cfg(test)] mod tests { use super::*; #[test] fn inspect() { Records::new(); } }',
    'macro_rules! scoped { () => { $crate::catalog::read() }; }',
    'fn expand() { quote! { crate::catalog::read(); }; syn::parse_quote!(crate::catalog::Catalog); }',
    'const EXAMPLE: &str = r##"crate::catalog::Catalog"##;',
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

test('the executable checks Rust files in a repository', async () => {
  const root = await TestWorkspace.create(tmpdir(), 'pyxis-rust-import');
  const command = fileURLToPath(new URL('./check-imports.mjs', import.meta.url));
  try {
    await writeFile(root.path('sample.rs'), 'fn inspect() { crate::catalog::read(); }', 'utf8');
    const invalid = spawnSync(process.execPath, [command], { cwd: root.root, encoding: 'utf8' });
    assert.equal(invalid.status, 1);
    assert.match(invalid.stderr, /sample.rs:1:16: \[rust-inline-path\]/);
    await writeFile(root.path('sample.rs'), 'use crate::catalog; fn inspect() { catalog::read(); }', 'utf8');
    const valid = spawnSync(process.execPath, [command], { cwd: root.root, encoding: 'utf8' });
    assert.equal(valid.status, 0);
    assert.match(valid.stdout, /Import check passed/);
  } finally {
    await root.close();
  }
});
