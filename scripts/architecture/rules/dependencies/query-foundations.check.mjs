import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../testing/fixtures.mjs';
import { frontendLayerBoundaryRule } from './frontend-layer-boundary.mjs';
import { capabilityBoundaryRule } from '../capabilities/capability-boundary.mjs';

test('editing and resource projections consume their own rules and public contracts', () => {
  for (const [source, target] of [
    ['src/domain/edit-session.ts', 'src/domain/project/save-edits.ts'],
    ['src/app/composables/use-edit-target-draft-session.ts', 'src/domain/project/save-edits.ts'],
    ['src/app/composables/use-edit-target-draft-session.ts', 'src/stores/project-sync.store.ts'],
    ['src/domain/resources/hull-references.ts', 'src/domain/schema/schema-options.ts'],
  ])
    for (const typeOnly of [false, true]) {
      assert.ok(source && target);
      const context = architectureFixtures({
        [source]: `\nimport ${typeOnly ? 'type ' : ''}{Value as Selected} from '@/${target.slice(4, -3)}';`,
        [target]: 'export interface Value {}',
      });
      const diagnostics = frontendLayerBoundaryRule.check(context);
      assert.equal(diagnostics.length, 1);
      const diagnostic = diagnostics[0];
      assert.ok(diagnostic);
      assert.equal(diagnostic.file, source);
      assert.equal(diagnostic.line, 2);
      assert.equal(diagnostic.target, target);
      assert.equal(diagnostic.expected, 'owned projection or shared contract');
    }
  for (const [source, target] of [
    ['src/app/composables/use-edit-target-draft-session.ts', 'src/domain/edit-session.ts'],
    ['src/domain/resources/hull-references.ts', 'src/shared/types/resources.types.ts'],
    ['src/stores/project-sync.store.ts', 'src/shared/types/write-commit.types.ts'],
  ]) {
    assert.ok(source && target);
    const context = architectureFixtures({
      [source]: `import type {Value} from '@/${target.slice(4, -3)}';`,
      [target]: 'export interface Value {}',
    });
    assert.deepEqual(frontendLayerBoundaryRule.check(context), []);
  }
});

for (const [source, target] of /** @type {const} */ ([
  ['src/shared/types/query-cache.types.ts', 'src/shared/types/resources.types.ts'],
  ['src/shared/types/query-cache.types.ts', 'src/shared/types/joint-edit.types.ts'],
  ['src/shared/types/query-cache.types.ts', 'src/shared/types/tables.types.ts'],
  ['src/shared/types/cache-limits.types.ts', 'src/shared/types/query-cache.types.ts'],
  ['src/shared/types/cache-limits.types.ts', 'src/shared/types/app-settings.types.ts'],
  ['src/services/query-cache.service.ts', 'src/services/entity-query.service.ts'],
  ['src/services/query-cache.service.ts', 'src/services/source-options.service.ts'],
  ['src/services/query-cache.service.ts', 'src/services/hull-reference.service.ts'],
  ['src/services/query-cache.service.ts', 'src/services/resource-reference.service.ts'],
])) {
  for (const typeOnly of [true, false])
    test(source + ' retains its foundation boundary to ' + target + ' type=' + typeOnly, () => {
      const files = architectureFixtures({
        [source]: 'import ' + (typeOnly ? 'type ' : '') + "{ Value } from '@/" + target.slice(4, -3) + "';",
        [target]: 'export interface Value {}',
      });
      assert.equal([...messages(frontendLayerBoundaryRule.check(files)), ...messages(capabilityBoundaryRule.check(files))].length, 1);
    });
}
for (const [source, target, name] of /** @type {const} */ ([
  ['src/app/composables/use-example.ts', 'src/services/entity-query.service.ts', 'hasEntityInvalidation'],
  ['src/app/composables/use-example.ts', 'src/services/csv-table.service.ts', 'hasTableInvalidation'],
  ['src/app/composables/use-example.ts', 'src/services/source-options.service.ts', 'hasSourceInvalidation'],
  ['src/services/resource-reference.service.ts', 'src/services/query-cache.service.ts', 'readLiveSessionQuery'],
]))
  test(name + ' has a formal consumer', () => {
    const files = architectureFixtures({
      [source]: 'import { ' + name + " } from '@/" + target.slice(4, -3) + "';",
      [target]: 'export function ' + name + '() {}',
    });
    assert.deepEqual([...messages(frontendLayerBoundaryRule.check(files)), ...messages(capabilityBoundaryRule.check(files))], []);
  });
