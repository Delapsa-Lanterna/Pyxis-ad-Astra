import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../testing/fixtures.mjs';
import { frontendLayerBoundaryRule } from './frontend-layer-boundary.mjs';
import { capabilityBoundaryRule } from '../capabilities/capability-boundary.mjs';

for (const [source, target] of [
  ['src/shared/types/query-cache.types.ts', 'src/shared/types/resources.types.ts'],
  ['src/shared/types/query-cache.types.ts', 'src/shared/types/joint-edit.types.ts'],
  ['src/shared/types/query-cache.types.ts', 'src/shared/types/tables.types.ts'],
  ['src/shared/types/cache-limits.types.ts', 'src/shared/types/query-cache.types.ts'],
  ['src/shared/types/cache-limits.types.ts', 'src/shared/types/app-settings.types.ts'],
  ['src/services/query-cache.service.ts', 'src/services/entity-query.service.ts'],
  ['src/services/query-cache.service.ts', 'src/services/source-options.service.ts'],
  ['src/services/query-cache.service.ts', 'src/services/hull-reference.service.ts'],
  ['src/services/query-cache.service.ts', 'src/services/resource-reference.service.ts'],
]) {
  for (const typeOnly of [true, false])
    test(source + ' retains its foundation boundary to ' + target + ' type=' + typeOnly, () => {
      const files = architectureFixtures({
        [source]: 'import ' + (typeOnly ? 'type ' : '') + "{ Value } from '@/" + target.slice(4, -3) + "';",
        [target]: 'export interface Value {}',
      });
      assert.equal([...messages(frontendLayerBoundaryRule.check(files)), ...messages(capabilityBoundaryRule.check(files))].length, 1);
    });
}
for (const [source, target, name] of [
  ['src/app/composables/use-example.ts', 'src/services/entity-query.service.ts', 'hasEntityInvalidation'],
  ['src/app/composables/use-example.ts', 'src/services/csv-table.service.ts', 'hasTableInvalidation'],
  ['src/app/composables/use-example.ts', 'src/services/source-options.service.ts', 'hasSourceInvalidation'],
  ['src/services/resource-reference.service.ts', 'src/services/query-cache.service.ts', 'createLiveSessionQuery'],
])
  test(name + ' has a formal consumer', () => {
    const files = architectureFixtures({
      [source]: 'import { ' + name + " } from '@/" + target.slice(4, -3) + "';",
      [target]: 'export function ' + name + '() {}',
    });
    assert.deepEqual([...messages(frontendLayerBoundaryRule.check(files)), ...messages(capabilityBoundaryRule.check(files))], []);
  });
