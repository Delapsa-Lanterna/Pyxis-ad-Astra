import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../testing/fixtures.mjs';
import { namingBoundaryRule } from './naming-boundary.mjs';

test('file responsibility suffixes and store identities use the declared convention', () => {
  const legal = architectureFixtures({
    'src/stores/sample.store.ts': "import {defineStore as store} from 'pinia'; store('sample-state',()=>({}));",
  });
  assert.deepEqual(namingBoundaryRule.check(legal), []);
  const invalid = architectureFixtures({
    'src/stores/sample.store.ts': "import {defineStore as store} from 'pinia';\nstore('SampleState',()=>({}));",
  });
  const [diagnostic] = namingBoundaryRule.check(invalid);
  assert.ok(diagnostic);
  assert.equal(diagnostic.ruleId, 'naming-boundary');
  assert.equal(diagnostic.line, 2);
  assert.equal(diagnostic.symbol, 'SampleState');
  const [suffix] = namingBoundaryRule.check(architectureFixtures({ 'src/services/sample.ts': 'export function read() {}' }));
  assert.ok(suffix);
  assert.equal(suffix.file, 'src/services/sample.ts');
  assert.match(suffix.message, /\.service\.ts/);
});
test('Vue declared event names preserve model updates and kebab-case actions', () => {
  const legal = architectureFixtures({
    'src/app/components/Sample.vue':
      '<script setup lang="ts">const send=defineEmits<{ "update:modelValue":[value:string]; "open-item":[] }>(); send("open-item");</script>',
  });
  assert.deepEqual(namingBoundaryRule.check(legal), []);
  const invalid = architectureFixtures({
    'src/app/components/Sample.vue': '<script setup lang="ts">\nconst send=defineEmits<{ openItem:[] }>();\nsend("openItem");</script>',
  });
  const diagnostics = namingBoundaryRule.check(invalid);
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(
    diagnostics.map(({ line, symbol }) => ({ line, symbol })),
    [
      { line: 2, symbol: 'openItem' },
      { line: 3, symbol: 'openItem' },
    ],
  );
});
