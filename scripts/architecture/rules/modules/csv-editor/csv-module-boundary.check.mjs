import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../../testing/fixtures.mjs';
import { csvModuleBoundaryRule } from './csv-module-boundary.mjs';

test('table workspace search fields consume the toolbar select outside the grid', () => {
  const files = architectureFixtures({
    'src/app/components/csv-editor/CsvEditorWorkspace.vue':
      '<template><n-select :options="searchOptions" @update:value="csvTable.setSearchField" /></template>' +
      "<script setup>import { csvSearchOptions } from '@/domain/csv-editor/csv-search';</script>",
  });
  assert.deepEqual(messages(csvModuleBoundaryRule.check(files)), []);
});

test('grid cell selection retains its dedicated picker boundary', () => {
  const files = architectureFixtures({
    'src/app/components/csv-editor/CsvGrid.vue': '<template><n-select :options="searchOptions" /></template>',
  });
  assert.equal(messages(csvModuleBoundaryRule.check(files)).length, 1);
});
