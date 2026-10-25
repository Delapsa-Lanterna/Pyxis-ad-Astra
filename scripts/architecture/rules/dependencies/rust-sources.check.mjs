import assert from 'node:assert/strict';
import test from 'node:test';
import { messages, architectureFixtures } from '../../testing/fixtures.mjs';
import { rustProjectLayerBoundaryRule } from './rust-project-layer-boundary.mjs';

test('source reading consumes IO and project record types', () => {
  const files = architectureFixtures({
    'src-tauri/src/services/project/sources/mod.rs':
      'fn read() { crate::io::read_versioned_json(); crate::services::project::model::LoadedSpecRecord; }',
  });
  assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(files)), []);
});
test('queries, table caches and resources consume source capabilities', () => {
  for (const role of ['query', 'cache', 'resources']) {
    const files = architectureFixtures({
      [`src-tauri/src/services/project/${role}/reader.rs`]:
        'fn read() { crate::services::project::sources::core::load_core_ship_files(); }',
    });
    assert.deepEqual(messages(rustProjectLayerBoundaryRule.check(files)), []);
  }
});
test('source reading keeps transaction and query actions at their owners', () => {
  for (const role of ['write', 'query']) {
    const files = architectureFixtures({
      'src-tauri/src/services/project/sources/mod.rs': `fn read() { crate::services::project::${role}::run(); }`,
    });
    assert.match(messages(rustProjectLayerBoundaryRule.check(files)).join('\n'), /project-sources must not depend/);
  }
});
