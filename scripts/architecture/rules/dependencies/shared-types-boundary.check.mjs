import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../testing/fixtures.mjs';

import { sharedTypesBoundaryRule } from './shared-types-boundary.mjs';

test('shared type ownership uses resolved module identity for all import forms', () => {
  const files = architectureFixtures({
    'src/shared/types/index.ts': "export type { Shape } from './shape.types';",
    'src/shared/types/shape.types.ts': 'export interface Shape {}',
    'src/shared/types/other.types.ts': "type Shape = import('./index').Shape;",
    'src/domain/sample.ts': "type Shape = import('@/shared/types/shape.types').Shape;",
  });
  assert.equal(messages(sharedTypesBoundaryRule.check(files)).length, 2);
});
