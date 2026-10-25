import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../../testing/fixtures.mjs';

import { capabilityBoundaryRule } from '../../capabilities/capability-boundary.mjs';
import { frontendLayerBoundaryRule } from '../../dependencies/frontend-layer-boundary.mjs';
import { projectResourcesBoundaryRule } from './project-resources-boundary.mjs';

const cases = [
  ['core-fields-read', 'src/orchestrators/core-assets.orchestrator.ts', 'src/services/core-assets.service.ts', 'queryCoreFields'],
  ['core-graphics-read', 'src/orchestrators/core-assets.orchestrator.ts', 'src/services/core-assets.service.ts', 'queryCoreGraphics'],
  ['hull-query', 'src/app/composables/use-sample.ts', 'src/services/hull-reference.service.ts', 'queryHullReferenceOptions'],
  [
    'immersive-hull-query',
    'src/app/composables/immersive-editor/use-immersive-editor-runtime.ts',
    'src/services/hull-reference.service.ts',
    'querySessionHullReferences',
  ],
  [
    'resource-reference',
    'src/app/composables/editors/use-resource-reference.ts',
    'src/services/resource-reference.service.ts',
    'resolveModImageReference',
  ],
  ['resource-observe', 'src/app/composables/use-sample.ts', 'src/services/resource-media.service.ts', 'hasResourceInvalidation'],
  ['resource-key', 'src/app/composables/use-sample.ts', 'src/services/resource-media.service.ts', 'mediaResourceKey'],
  ['resource-read', 'src/services/spec-ship-editor.service.ts', 'src/services/resource-media.service.ts', 'queryResourceDataUrls'],
  [
    'draft-resource-query',
    'src/services/spec-ship-editor.service.ts',
    'src/services/resource-reference.service.ts',
    'querySessionDraftResources',
  ],
  [
    'resource-project-invalidate',
    'src/orchestrators/project-sync.orchestrator.ts',
    'src/services/resource-media.service.ts',
    'invalidateResourceMediaByProject',
  ],
  [
    'resource-session-clear',
    'src/orchestrators/workspace-lifecycle.orchestrator.ts',
    'src/services/resource-media.service.ts',
    'invalidateResourceMediaForSession',
  ],
  [
    'core-clear',
    'src/orchestrators/workspace-lifecycle.orchestrator.ts',
    'src/services/core-assets.service.ts',
    'invalidateCoreCacheForRoot',
  ],
];

for (const [capability, from, target, name] of cases) {
  test(`${capability} is accepted at its formal owner`, () => {
    const source = `import { ${name} } from '@/${target.slice(4, -3)}';`;
    const files = architectureFixtures({
      [from]: from.endsWith('.vue') ? `<script setup>${source}</script><template><div /></template>` : source,
      [target]: `export function ${name}() {}`,
    });
    assert.deepEqual(messages(frontendLayerBoundaryRule.check(files)), []);
    assert.deepEqual(messages(capabilityBoundaryRule.check(files)), []);
  });
  test(`${capability} is rejected from a window capability consumer`, () => {
    const files = architectureFixtures({
      'src/windows/audit.window.ts': `import { ${name} } from '@/${target.slice(4, -3)}';`,
      [target]: `export function ${name}() {}`,
    });
    assert.equal([...messages(frontendLayerBoundaryRule.check(files)), ...messages(capabilityBoundaryRule.check(files))].length, 1);
  });
}

test('Core commands reject a second Schema backend route even when the Project Resources route exists', () => {
  const files = architectureFixtures({
    'src-tauri/src/services/mod.rs': 'pub(crate) use project::resources::core_assets::scan_core_fields;',
    'src-tauri/src/commands/core_assets.rs':
      'pub fn scan_core_fields() { crate::services::scan_core_fields(); crate::services::schema::scan_core_fields(); }',
  });
  const diagnostics = projectResourcesBoundaryRule.check(files);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].expected, 'services::project::resources::core_assets');
});
