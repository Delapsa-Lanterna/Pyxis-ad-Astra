import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { csvValidationColumnsRule } from './csv-validation-columns.mjs';

const file = 'schemas/csv/sample.schema.json';
const columns = [
  { key: 'cost', control: 'number' },
  { key: 'name', control: 'text' },
];
/** @param {Record<string, unknown>} validation @param {typeof columns} [declarations] */
function check(validation, declarations = columns) {
  const source = JSON.stringify({ columns: declarations, validation }, null, 2);
  const diagnostics = csvValidationColumnsRule.check(architectureFixtures({ [file]: source }));
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.file, file);
    assert.equal(diagnostic.ruleId, 'csv-validation-columns');
    assert.equal(source.split('\n')[diagnostic.line - 1]?.[diagnostic.column - 1], '"');
  }
  return diagnostics;
}
test('CSV validation accepts registered columns and numeric limits', () => {
  assert.deepEqual(
    check({
      integer: ['cost'],
      required: ['name'],
      requiredColumn: ['cost'],
      script: ['name'],
      warningMin: { cost: -2 },
      warningMax: { cost: 8 },
    }),
    [],
  );
});
test('CSV declarations report the repeated column at its second definition', () => {
  const [duplicate] = check({}, [...columns, { key: 'cost', control: 'number' }]);
  assert.equal(duplicate?.target, 'cost');
  assert.equal(duplicate?.line, 12);
});
test('CSV validation locates the target for each declaration', () => {
  for (const rule of ['required', 'requiredColumn', 'script', 'integer', 'warningMin', 'warningMax']) {
    const payload = rule.startsWith('warning') ? { missing: 2 } : ['missing'];
    const [error] = check({ [rule]: payload });
    assert.equal(error?.target, rule + '.missing');
    assert.equal(error?.expected, 'declared column key');
    assert.equal(error?.line, 14);
  }
  for (const rule of ['integer', 'warningMin', 'warningMax']) {
    assert.equal(check({ [rule]: rule === 'integer' ? ['name'] : { name: 3 } })[0]?.expected, 'number');
  }
  assert.equal(check({ integers: ['cost'] })[0]?.target, 'integers');
});

test('the ships salary constraint reports a misspelled target in the actual asset', () => {
  const path = 'schemas/csv/ships.schema.json';
  const source = readFileSync(new URL('../../../../../' + path, import.meta.url), 'utf8');
  const assets = { [path]: source };
  assert.deepEqual(csvValidationColumnsRule.check(architectureFixtures(assets)), []);
  const schema = JSON.parse(source);
  schema.validation.integer = schema.validation.integer.map(/** @param {string} key */ (key) => (key === 'salary' ? 'salray' : key));
  assets[path] = JSON.stringify(schema, null, 2);
  const [error] = csvValidationColumnsRule.check(architectureFixtures(assets));
  assert.ok(error);
  assert.equal(error.target, 'integer.salray');
  assert.equal(assets[path].split('\n')[error.line - 1]?.trim(), '"salray"');
});
