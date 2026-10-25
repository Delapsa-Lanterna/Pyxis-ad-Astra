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
  for (const field of ['ownerKind', 'ownerId']) {
    const failures = messages(
      resourceBoundaryRule.check(
        architectureFixtures({ 'src/app/composables/use-source.ts': "const resource = { source: 'mod', " + field + ": 'ship' };" }),
      ),
    );
    assert.equal(failures.length, 1);
    assert.match(failures[0], /backend query output/);
  }
});
