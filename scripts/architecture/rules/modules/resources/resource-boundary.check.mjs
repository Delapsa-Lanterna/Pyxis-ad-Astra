import assert from 'node:assert/strict';
import test from 'node:test';
import { resourceBoundaryRule } from './resource-boundary.mjs';
import { messages, architectureFixtures } from '../../../testing/fixtures.mjs';
test('invalidation scopes carry source and path without granting ResourceRef ownership', () => {
  assert.deepEqual(
    messages(
      resourceBoundaryRule.check(
        architectureFixtures({
          'src/orchestrators/project-sync.orchestrator.ts': "const scope = { source: 'mod', relPath: 'data/hulls' };",
        }),
      ),
    ),
    [],
  );
  {
    const failures = messages(
      resourceBoundaryRule.check(
        architectureFixtures({
          'src/shared/types/project-identity.types.ts':
            'export interface ResourceRef { source:string; ownerKind:string; ownerId:string; path:string; }',
          'src/app/composables/use-source.ts':
            'import type {ResourceRef as Reference} from "@/shared/types/project-identity.types"; const resource: Reference = { source:"mod", ownerKind:"ship", ownerId:"id", path:"data" };',
        }),
      ),
    );
    assert.equal(failures.length, 1);
    assert.ok(failures[0]);
    assert.match(failures[0], /backend query output/);
  }
  assert.deepEqual(
    resourceBoundaryRule.check(
      architectureFixtures({ 'src/app/composables/use-source.ts': 'const owner = { ownerKind:"local", ownerId:"draft" };' }),
    ),
    [],
  );
});
