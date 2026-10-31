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

test('history capacity references belong to window assembly with or without a grid', () => {
  for (const withGrid of [false, true])
    for (const expression of ['csv.setHistoryLimit(1);', 'watch(limit,csv.setHistoryLimit);']) {
      const source = "import {useCsvEditorStore as history} from '@/stores/csv-editor.store'; const csv=history();\n" + expression;
      const provider = { 'src/stores/csv-editor.store.ts': 'export function useCsvEditorStore() {}' };
      /** @type {Record<string, string>} */
      const grid = withGrid ? { 'src/app/components/csv-editor/CsvGrid.vue': '<template><div /></template>' } : {};
      const legal = architectureFixtures({ ...provider, ...grid, 'src/app/composables/use-app-lifecycle-assembly.ts': source });
      assert.deepEqual(csvModuleBoundaryRule.check(legal), []);
      const invalid = architectureFixtures({ ...provider, ...grid, 'src/orchestrators/settings-persistence.orchestrator.ts': source });
      const [diagnostic] = csvModuleBoundaryRule.check(invalid);
      assert.ok(diagnostic);
      assert.equal(diagnostic.ruleId, 'csv-module-boundary');
      assert.equal(diagnostic.file, 'src/orchestrators/settings-persistence.orchestrator.ts');
      assert.equal(diagnostic.line, 2);
      assert.ok(diagnostic.column > 0);
      assert.equal(diagnostic.symbol, 'setHistoryLimit');
      assert.equal(diagnostic.target, 'src/stores/csv-editor.store.ts');
      assert.equal(diagnostic.expected, 'src/app/composables/use-app-lifecycle-assembly.ts');
    }
});

test('local history functions retain their local meaning', () => {
  const local = architectureFixtures({
    'src/app/composables/use-history.ts': 'function setHistoryLimit() {} setHistoryLimit(); watch(limit,setHistoryLimit);',
  });
  assert.deepEqual(csvModuleBoundaryRule.check(local), []);
});
