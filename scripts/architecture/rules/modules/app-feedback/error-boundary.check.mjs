import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { errorBoundaryRule } from './error-boundary.mjs';

for (const layer of ['services', 'orchestrators']) {
  const rel = 'src/' + layer + '/sample.' + (layer === 'services' ? 'service' : 'orchestrator') + '.ts';
  test(layer + ' delivers structured application failures', () => {
    const legal = architectureFixtures({
      [rel]: 'function run(){ throw new AppError("sample",{action:"read"}); } // throw new Error("sample");',
    });
    assert.deepEqual(errorBoundaryRule.check(legal), []);
    const invalid = architectureFixtures({ [rel]: '\nfunction run(){ throw new Error("sample"); }' });
    const [diagnostic] = errorBoundaryRule.check(invalid);
    assert.equal(diagnostic.ruleId, 'error-boundary');
    assert.equal(diagnostic.line, 2);
    assert.equal(diagnostic.symbol, 'Error');
    assert.equal(diagnostic.expected, 'AppError');
  });
}
test('pure domain values and colocated tests retain their own error semantics', () => {
  const context = architectureFixtures({
    'src/domain/sample.ts': 'throw new Error("sample");',
    'src/services/sample.spec.ts': 'throw new Error("sample");',
  });
  assert.deepEqual(errorBoundaryRule.check(context), []);
});
