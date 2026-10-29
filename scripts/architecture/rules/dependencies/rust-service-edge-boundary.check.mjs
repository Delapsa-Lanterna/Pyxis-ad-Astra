import assert from 'node:assert/strict';
import test from 'node:test';
import { rustServiceEdgeBoundaryRule } from './rust-service-edge-boundary.mjs';
import { messages, architectureFixtures } from '../../testing/fixtures.mjs';

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
  assert.match(failures[0], /must not depend on service project/);
});
