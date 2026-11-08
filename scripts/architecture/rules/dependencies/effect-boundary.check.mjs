import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../testing/fixtures.mjs';
import { effectBoundaryRule } from './effect-boundary.mjs';

test('pure roles and read-only queries report native capability evidence', () => {
  const context = architectureFixtures({
    'src/domain/sample.ts': 'export function read(){ return fetch("https://example.invalid/data"); }',
    'src-tauri/src/services/project/query/sample.rs': 'pub fn query(){std::fs::remove_file("sample");}',
  });
  const diagnostics = effectBoundaryRule.check(context);
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every((item) => item.target && item.symbol && item.line === 1));
  assert.deepEqual(diagnostics.map((item) => item.expected).sort(), ['pure computation', 'read-only query']);
});

test('query IO and cache scans depend on native operations after internal renames', () => {
  for (const name of ['load_all_core', 'calculate']) {
    const context = architectureFixtures({
      'src-tauri/src/services/project/cache/sample.rs':
        'use crate::services::project::sources::core::' + name + '; pub fn lookup(){' + name + '();}',
      'src-tauri/src/services/project/sources/core.rs': 'pub fn ' + name + '(){std::fs::read_dir("sample");}',
    });
    const diagnostics = effectBoundaryRule.check(context);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.symbol, 'std::fs::read_dir');
    assert.equal(diagnostics[0]?.expected, 'typed lazy cache without directory scans');
  }
  const pure = architectureFixtures({
    'src-tauri/src/services/project/query/sample.rs': 'pub fn write(){1;} pub fn query(){write();}',
    'src-tauri/src/services/project/cache/sample.rs': 'pub fn load_all_core(){1;}',
  });
  assert.deepEqual(effectBoundaryRule.check(pure), []);
});

test('all source catalog query products retain read-only native effects', () => {
  for (const leaf of ['values', 'images', 'config_sources']) {
    const rel = 'src-tauri/src/services/project/query/source_catalog/' + leaf + '.rs';
    const diagnostics = effectBoundaryRule.check(architectureFixtures({ [rel]: 'fn run(){std::fs::write(path,bytes);}' }));
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.expected, 'read-only query');
    assert.equal(diagnostics[0]?.file, rel);
  }
});

test('read-only queries preserve actual native receiver write capabilities', () => {
  const diagnostics = effectBoundaryRule.check(
    architectureFixtures({
      'src-tauri/src/services/project/query/sample.rs':
        'use std::fs::File; pub fn query(){let mut stream=File::open("sample"); stream.write_all(bytes);}',
    }),
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.symbol, 'std::fs::File::write_all');
});
