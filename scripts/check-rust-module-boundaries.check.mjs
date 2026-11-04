import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkRustModuleBoundaries, rustModuleBoundaryContext } from './check-rust-module-boundaries.mjs';

/** @param {Record<string, string>} sources @param {Record<string, string>} owners */
function analyze(sources, owners) {
  const files = Object.entries(sources).map(([rel, text]) => ({ path: rel, rel, text }));
  const context = rustModuleBoundaryContext(files, new Map(Object.entries(owners)));
  return Object.fromEntries(files.map((file) => [file.rel, checkRustModuleBoundaries(file, context)]));
}

test('business export entries point directly to declarations', () => {
  const diagnostics = analyze(
    {
      'src-tauri/src/services/mod.rs': 'pub use catalog::{Catalog, read};',
      'src-tauri/src/services/catalog.rs': 'pub struct Catalog; pub fn read() {}',
    },
    {
      'src-tauri/src/services/mod.rs': 'backend-capabilities',
      'src-tauri/src/services/catalog.rs': 'catalog',
    },
  );
  assert.deepEqual(diagnostics['src-tauri/src/services/mod.rs'], []);
});

test('business export chains report their re-export depth', () => {
  const diagnostics = analyze(
    {
      'src-tauri/src/services/mod.rs': 'pub use facade::read;',
      'src-tauri/src/services/facade.rs': 'pub use super::implementation::read;',
      'src-tauri/src/services/implementation.rs': 'pub fn read() {}',
    },
    {
      'src-tauri/src/services/mod.rs': 'backend-capabilities',
      'src-tauri/src/services/facade.rs': 'backend-capabilities',
      'src-tauri/src/services/implementation.rs': 'catalog',
    },
  );
  assert.deepEqual(
    (diagnostics['src-tauri/src/services/mod.rs'] ?? []).map(({ ruleId }) => ruleId),
    ['rust-business-export-chain'],
  );
});

test('business exports list their items instead of globbing', () => {
  const diagnostics = analyze(
    {
      'src-tauri/src/services/mod.rs': 'pub use catalog::*;',
      'src-tauri/src/services/catalog.rs': 'pub struct Catalog;',
    },
    {
      'src-tauri/src/services/mod.rs': 'backend-capabilities',
      'src-tauri/src/services/catalog.rs': 'catalog',
    },
  );
  assert.deepEqual(
    (diagnostics['src-tauri/src/services/mod.rs'] ?? []).map(({ ruleId }) => ruleId),
    ['rust-business-export-glob'],
  );
});

test('cross-business types use their declared names while function namespaces stay modular', () => {
  const diagnostics = analyze(
    {
      'src-tauri/src/services/consumer.rs': 'use crate::services::catalog; fn read(_: catalog::Catalog) { catalog::read(); }',
      'src-tauri/src/services/catalog.rs': 'pub struct Catalog; pub fn read() {}',
    },
    {
      'src-tauri/src/services/consumer.rs': 'consumer',
      'src-tauri/src/services/catalog.rs': 'catalog',
    },
  );
  assert.deepEqual(
    (diagnostics['src-tauri/src/services/consumer.rs'] ?? []).map(({ ruleId, symbol }) => ({ ruleId, symbol })),
    [{ ruleId: 'rust-business-import-type', symbol: 'crate::services::catalog::Catalog' }],
  );
  const named = analyze(
    {
      'src-tauri/src/services/consumer.rs': 'use crate::services::catalog::Catalog; fn read(_: Catalog) {}',
      'src-tauri/src/services/catalog.rs': 'pub struct Catalog;',
    },
    {
      'src-tauri/src/services/consumer.rs': 'consumer',
      'src-tauri/src/services/catalog.rs': 'catalog',
    },
  );
  assert.deepEqual(named['src-tauri/src/services/consumer.rs'] ?? [], []);
});

test('technical aggregation roots retain their one-layer glob exports', () => {
  const diagnostics = analyze(
    {
      'src-tauri/src/commands/mod.rs': 'pub use catalog::*;',
      'src-tauri/src/commands/catalog.rs': 'pub fn query() {}',
    },
    {
      'src-tauri/src/commands/mod.rs': 'backend-capabilities',
      'src-tauri/src/commands/catalog.rs': 'catalog',
    },
  );
  assert.deepEqual(diagnostics['src-tauri/src/commands/mod.rs'] ?? [], []);
});
