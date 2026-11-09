import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../testing/fixtures.mjs';
import { rawSourceTextReads } from './rule-source.mjs';

test('source text property access and destructuring retain source positions', () => {
  const context = architectureFixtures({
    'scripts/architecture/rules/sample.mjs':
      'export function inspect(file) {\n const direct=file.text;\n const {text:source}=file;\n const indexed=file["text"];\n}',
  });
  const file = context.byPath.get('scripts/architecture/rules/sample.mjs');
  assert.ok(file);
  assert.deepEqual(rawSourceTextReads(file), [
    { line: 2, column: 20 },
    { line: 3, column: 9 },
    { line: 4, column: 22 },
  ]);
});
