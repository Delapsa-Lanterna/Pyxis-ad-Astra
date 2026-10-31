import assert from 'node:assert/strict';
import test from 'node:test';
import { rustServiceEdgeBoundaryRule } from './rust-service-edge-boundary.mjs';
import { messages, architectureFixtures } from '../../testing/fixtures.mjs';

test('directory opening and Mod creation consume the formal source root capability', () => {
  for (const source of ['src-tauri/src/services/directory_opening/detection.rs', 'src-tauri/src/services/mod_creation.rs']) {
    const context = architectureFixtures({ [source]: 'fn resolve() { crate::services::project::resolve_game_mods_directory(root); }' });
    assert.deepEqual(rustServiceEdgeBoundaryRule.check(context), []);
  }
  const context = architectureFixtures({
    'src-tauri/src/services/mod_creation.rs': '\nfn resolve() { crate::services::directory_opening::scan_game_overview(root); }',
  });
  const [diagnostic] = rustServiceEdgeBoundaryRule.check(context);
  assert.ok(diagnostic);
  assert.equal(diagnostic.file, 'src-tauri/src/services/mod_creation.rs');
  assert.equal(diagnostic.line, 2);
  assert.equal(diagnostic.target, 'crate::services::directory_opening::scan_game_overview');
});

test('session opening consumes the official settings root', () => {
  const context = architectureFixtures({
    'src-tauri/src/services/project_session.rs': 'fn open() { crate::services::app_settings::starsector_root(); }',
  });
  assert.deepEqual(messages(rustServiceEdgeBoundaryRule.check(context)), []);
});

test('session release publishes reference changes through project sync', () => {
  const context = architectureFixtures({
    'src-tauri/src/services/project_session.rs': 'fn release() { crate::services::project_sync::publish_references(snapshot, updates); }',
  });
  assert.deepEqual(messages(rustServiceEdgeBoundaryRule.check(context)), []);
});

test('application assembly consumes the media cache configuration capability', () => {
  assert.deepEqual(
    messages(
      rustServiceEdgeBoundaryRule.check(
        architectureFixtures({
          'src-tauri/src/commands/app_lifecycle.rs': 'fn load() { crate::services::project::configure_media_cache(&limits); }',
        }),
      ),
    ),
    [],
  );
});
test('settings consumers keep unrelated project capabilities at their owner', () => {
  const failures = messages(
    rustServiceEdgeBoundaryRule.check(
      architectureFixtures({
        'src-tauri/src/services/app_settings.rs': 'fn load() { crate::services::project::query_resource_data_urls(&resources); }',
      }),
    ),
  );
  assert.equal(failures.length, 1);
  assert.ok(failures[0]);
  assert.match(failures[0], /must not depend on service project/);
});
