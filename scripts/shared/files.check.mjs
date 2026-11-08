import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pairedSourcePaths } from './files.mjs';
test('test counterparts preserve language and directory identity', () => {
  assert.deepEqual(pairedSourcePaths('src/value.check.mjs'), ['src/value.mjs', 'src/value.vue', 'src/value.js']);
  assert.deepEqual(pairedSourcePaths('src/value.spec.ts'), ['src/value.ts', 'src/value.vue']);
  assert.deepEqual(pairedSourcePaths('src/value_tests.rs'), ['src/value.rs']);
  assert.deepEqual(pairedSourcePaths('src/value.ts'), []);
});
