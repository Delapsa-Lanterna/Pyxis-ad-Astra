import assert from 'node:assert/strict';
import { test } from 'node:test';
import { moduleDependencyFixtures } from '../../testing/fixtures.mjs';
import { moduleConsumptionBoundaryRule } from './module-consumption-boundary.mjs';
test('module consumption checks every file behind a module pair and follows export origins', () => {
  const sources = {
    'src/domain/a.ts': "import { first } from './b'; import type {Second} from './barrel';",
    'src/domain/b.ts': 'export const first = 1;',
    'src/domain/c.ts': 'export interface Second {}',
    'src/domain/barrel.ts': "export type {Second} from './c';",
  };
  const owners = { alpha: ['src/domain/a.ts'], beta: ['src/domain/b.ts', 'src/domain/c.ts', 'src/domain/barrel.ts'] };
  const context = moduleDependencyFixtures(sources, owners);
  const document = context.documents.find((file) => file.rel.endsWith('/alpha.md'));
  assert.ok(document);
  document.document.references.push({ group: '消费', path: 'src/domain/b.ts', line: 1 });
  const [diagnostic] = moduleConsumptionBoundaryRule.check(context);
  assert.equal(diagnostic?.target, 'src/domain/c.ts');
  assert.equal(diagnostic?.symbol, 'Second');
  document.document.references.push({ group: '消费', path: 'src/domain/c.ts', line: 2 });
  assert.deepEqual(moduleConsumptionBoundaryRule.check(context), []);
});
