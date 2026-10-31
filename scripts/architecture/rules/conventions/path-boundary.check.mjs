import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { architectureFixtures } from '../../testing/fixtures.mjs';
import { collectArchitectureContext } from '../../facts/context.mjs';
import { pathBoundaryRule } from './path-boundary.mjs';

const source = 'src-tauri/src/services/sample.rs';
const counter = 'src-tauri/src/io/work.rs';
/** @param {string} text @param {string} [file] */
const check = (text, file = source) => pathBoundaryRule.check(architectureFixtures({ [file]: text }));

test('path expansion belongs to the formal IO boundary across invocation forms', () => {
  for (const text of [
    'fn run(path: &Path) { path.canonicalize(); }',
    'fn run(path: &Path) { std::fs::canonicalize(path); }',
    'use std::fs::canonicalize as expand; fn run(path: &Path) { expand(path); }',
    'fn run(path: &Path) { use std::fs as disk; disk::canonicalize(path); }',
    'fn run(path: &Path) { let expand = std::fs::canonicalize; expand(path); }',
    'fn run(path: &Path) { Path::canonicalize(path); }',
  ]) {
    const diagnostics = check('\n' + text);
    assert.ok(diagnostics.length >= 1);
    for (const diagnostic of diagnostics) {
      assert.equal(diagnostic.ruleId, 'path-boundary');
      assert.equal(diagnostic.file, source);
      assert.equal(diagnostic.line, 2);
      assert.ok(diagnostic.column > 1);
      assert.equal(diagnostic.expected, 'src-tauri/src/io/paths.rs');
    }
    assert.deepEqual(check(text, 'src-tauri/src/io/paths.rs'), []);
  }
});

test('filesystem identity operations consume shared string keys', () => {
  for (const body of [
    'root.to_lowercase()',
    'root.to_string_lossy()\n.to_lowercase()',
    'version.path.eq_ignore_ascii_case(&other.path)',
    'path.to_string_lossy().to_lowercase()',
    'input.to_string_lossy().to_ascii_lowercase()',
  ]) {
    const [diagnostic] = check('fn run(root: &str, path: &Path, input: &Path) { ' + body + '; }');
    assert.ok(diagnostic);
    assert.equal(diagnostic.expected, 'models::windows_path_key');
  }
  for (const body of [
    'name.to_lowercase()',
    'extension.eq_ignore_ascii_case(other)',
    'resource.rel_path.to_lowercase()',
    'text.to_lowercase()',
  ])
    assert.deepEqual(check('fn run() { ' + body + '; }'), []);
});

test('raw disk paths cannot enter string keys through aliases or local helpers', () => {
  for (const body of [
    'crate::models::windows_path_key(&path.to_string_lossy())',
    'let alias = path; crate::models::windows_path_key(&alias.to_string_lossy())',
    'let path = path.to_path_buf(); crate::models::windows_path_key(&path.to_string_lossy())',
    'let expanded = crate::io::canonical_path(other, "other"); crate::models::windows_path_key(&path.to_string_lossy())',
    'use crate::models::windows_path_key as key; key(\n &path.to_string_lossy()\n)',
    'let key = crate::models::windows_path_key; key(&path.to_string_lossy())',
  ]) {
    const [diagnostic] = check('fn helper(path: &Path) -> String { ' + body + ' }');
    assert.ok(diagnostic, body);
    assert.equal(diagnostic.expected, 'io::canonical_path or FsRootBoundary');
  }
  for (const expansion of [
    'let path = crate::io::canonical_path(path, "input")?;',
    'use crate::io::canonical_path as expand; let path = expand(path, "input")?;',
    'let path = crate::io::FsRootBoundary::new(path, "root")?.root();',
  ])
    assert.deepEqual(check('fn key(path: &Path) { ' + expansion + ' crate::models::windows_path_key(&path.to_string_lossy()); }'), []);
  for (const type of ['PathBuf', 'std::path::Path', 'DiskPath']) {
    const diagnostics = check(
      'use std::path::Path as DiskPath; fn key(input: &' + type + ') { crate::models::windows_path_key(&input.to_string_lossy()); }',
    );
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.target, 'input');
  }
});

test('public test counters are inspected while test cases and diagnostic text retain their roles', async () => {
  const broken = '#![cfg(test)]\nfn count(path: &Path) { crate::models::windows_path_key(&path.to_string_lossy()); }';
  assert.equal(check(broken, counter).length, 1);
  assert.deepEqual(check(broken + '\n#[test] fn case() { path.canonicalize(); }', counter), check(broken, counter));
  assert.deepEqual(
    check('// path.canonicalize();\nconst NOTE: &str = "root.to_lowercase()";\n#[test] fn case() { path.canonicalize(); }'),
    [],
  );
  const text = await readFile(counter, 'utf8');
  assert.deepEqual(check(text, counter), []);
  const regression = text.replaceAll(
    'let key = resource_key(path);',
    'let key = crate::models::windows_path_key(&path.to_string_lossy());',
  );
  const diagnostics = check(regression, counter);
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every((item) => item.target === 'path'));
});

test('repository path audit reports each current operation and reuses collected facts', async (t) => {
  const context = await collectArchitectureContext(process.cwd());
  const begin = performance.now();
  const diagnostics = pathBoundaryRule.check(context);
  assert.deepEqual(pathBoundaryRule.check(context), diagnostics);
  t.diagnostic(JSON.stringify({ files: context.rust.length, diagnostics: diagnostics.length, milliseconds: performance.now() - begin }));
  for (const item of diagnostics) t.diagnostic(`${item.file}:${item.line}:${item.column} ${item.target} -> ${item.expected}`);
});
