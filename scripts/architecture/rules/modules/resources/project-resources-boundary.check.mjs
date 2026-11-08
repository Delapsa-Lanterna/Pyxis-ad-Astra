import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { projectResourcesBoundaryRule } from './project-resources-boundary.mjs';
import assert from 'node:assert/strict';

test('Core commands reject a second Schema backend route even when the Project Resources route exists', () => {
  const files = architectureFixtures({
    'src-tauri/src/services/mod.rs': 'pub(crate) use project::resources::core_assets::scan_core_fields;',
    'src-tauri/src/commands/core_assets.rs':
      'pub fn scan_core_fields() { crate::services::scan_core_fields(); crate::services::schema::scan_core_fields(); }',
  });
  const diagnostics = projectResourcesBoundaryRule.check(files);
  assert.equal(diagnostics.length, 1);
  assert.ok(diagnostics[0]);
  assert.equal(diagnostics[0].expected, 'services::project::resources::core_assets');
});
