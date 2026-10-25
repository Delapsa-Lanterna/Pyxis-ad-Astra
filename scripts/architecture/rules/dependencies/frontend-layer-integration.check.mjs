import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../testing/fixtures.mjs';

import { frontendLayerBoundaryRule } from './frontend-layer-boundary.mjs';

test('runtime and type edges share one layer-violation diagnostic', () => {
  const files = architectureFixtures({
    'src/domain/sample.ts': "import { type Shape, run } from '@/stores/sample.store';",
    'src/stores/sample.store.ts': 'export interface Shape {} export function run() {}',
  });
  assert.equal(messages(frontendLayerBoundaryRule.check(files)).length, 1);
});
