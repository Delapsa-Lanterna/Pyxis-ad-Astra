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

test('destructuring source text is subject to the parsed-fact boundary', () => {
  const [diagnostic] = ruleBoundaryRule.check(
    context('export const rule=(file)=>{const {text:source}=file;return source.includes("sample");};'),
  );
  assert.ok(diagnostic);
  assert.equal(diagnostic.symbol, 'text');
  assert.equal(diagnostic.expected, 'parsed source facts');
});

test('registered rule identities and heading references resolve uniquely', () => {
  const fixtures = architectureFixtures({ [source]: '', '.zcode/module-map.md': '# Contract\n\n## Existing\n' });
  const rule = { ...registered, reference: '.zcode/module-map.md#existing' };
  assert.deepEqual(ruleBoundaryRule.check({ ...fixtures, registeredRules: [rule] }), []);
  const diagnostics = ruleBoundaryRule.check({
    ...fixtures,
    registeredRules: [rule, { ...rule, reference: '.zcode/module-map.md#missing' }],
  });
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.some((item) => item.expected === 'unique rule identity'));
  assert.ok(diagnostics.some((item) => item.target === '.zcode/module-map.md#missing'));
});

test('test discovery and counterpart checks consume the complete repository paths', () => {
  const fixtures = architectureFixtures({
    'package.json': JSON.stringify({ scripts: { 'test:checks': 'node --test "scripts/**/*.check.mjs"' } }),
    'scripts/sample.mjs': '',
    'scripts/sample.check.mjs': '',
    'elsewhere.check.mjs': '',
  });
  const diagnostics = ruleBoundaryRule.check(fixtures);
  assert.equal(diagnostics.length, 2);
  assert.ok(diagnostics.every((item) => item.file === 'elsewhere.check.mjs'));
});
