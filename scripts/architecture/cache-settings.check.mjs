import assert from 'node:assert/strict';
import test from 'node:test';
import { rustServiceEdgeBoundaryRule } from './rules/rust-service-edge-boundary.mjs';
import { architectureFixtures } from '../shared/check-fixtures.mjs';

test('application assembly consumes the media cache configuration capability', () => {
  assert.deepEqual(
    rustServiceEdgeBoundaryRule.check(
      architectureFixtures({
        'src-tauri/src/commands/app_lifecycle.rs': 'fn load() { crate::services::project::configure_media_cache(&limits); }',
      }),
    ),
    [],
  );
});
test('settings consumers keep unrelated project capabilities at their owner', () => {
  const failures = rustServiceEdgeBoundaryRule.check(
    architectureFixtures({
      'src-tauri/src/services/app_settings.rs': 'fn load() { crate::services::project::query_resource_data_urls(&resources); }',
    }),
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /must not depend on service project/);
});
