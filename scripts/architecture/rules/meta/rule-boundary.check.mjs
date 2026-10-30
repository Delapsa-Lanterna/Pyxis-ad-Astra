import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../testing/fixtures.mjs';
import { ruleBoundaryRule } from './rule-boundary.mjs';

const source = 'scripts/architecture/rules/sample.mjs';
const registered = { name: 'sample', reference: '.zcode/module-map.md', source, check: () => [] };
/** @param {string} text */
function context(text) {
  return { ...architectureFixtures({ [source]: text, '.zcode/module-map.md': '' }), registeredRules: [registered] };
}
test('registered rule source consumes parsed facts', () => {
  assert.deepEqual(ruleBoundaryRule.check(context('export const rule=(context)=>context.frontend;')), []);
  for (const text of ["\nimport {readFile} from 'node:fs/promises';", '\nexport const rule=(file)=>file.text.includes("sample");']) {
    const [diagnostic] = ruleBoundaryRule.check(context(text));
    assert.ok(diagnostic);
    assert.equal(diagnostic.ruleId, 'rule-boundary');
    assert.equal(diagnostic.line, 2);
  }
});
test('the fixed registration selects rule implementations independently of colocated tests', () => {
  const unregistered = architectureFixtures({ [source]: "import {readFile} from 'node:fs/promises';" });
  assert.deepEqual(ruleBoundaryRule.check(unregistered), []);
});

test('registered implementation helpers inherit the fact consumption boundary', () => {
  const helper = 'scripts/architecture/rules/helper.mjs';
  const fixtures = architectureFixtures({
    [source]: "import {inspect} from './helper.mjs';",
    [helper]: "\nimport {readFile} from 'node:fs/promises';",
    '.zcode/module-map.md': '',
  });
  const [diagnostic] = ruleBoundaryRule.check({ ...fixtures, registeredRules: [registered] });
  assert.ok(diagnostic);
  assert.equal(diagnostic.file, helper);
  assert.equal(diagnostic.line, 2);
  assert.equal(diagnostic.ruleId, 'rule-boundary');
  assert.equal(diagnostic.expected, 'repository facts or declared contract');
});
