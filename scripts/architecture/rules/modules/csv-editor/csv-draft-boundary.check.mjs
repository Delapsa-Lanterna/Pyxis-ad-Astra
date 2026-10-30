import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { csvDraftBoundaryRule } from './csv-draft-boundary.mjs';

const draft = 'src/domain/csv-editor/csv-table-draft.ts';
const provider = {
  [draft]:
    'export function setCsvCellValueDraft() {} export function hasCsvTableDraftChanges() {} export function commitCsvTableSaveDraft() {}',
};
for (const statement of [
  "import {setCsvCellValueDraft as change} from '@/domain/csv-editor/csv-table-draft';",
  "import * as draft from '@/domain/csv-editor/csv-table-draft';",
  "const draft=import('@/domain/csv-editor/csv-table-draft');",
]) {
  test('CSV mutation ownership follows ' + statement, () => {
    const invalid = architectureFixtures({ ...provider, 'src/app/composables/use-sample.ts': '\n' + statement });
    const [diagnostic] = csvDraftBoundaryRule.check(invalid);
    assert.ok(diagnostic);
    assert.equal(diagnostic.ruleId, 'csv-draft-boundary');
    assert.equal(diagnostic.line, 2);
    assert.equal(diagnostic.symbol, 'setCsvCellValueDraft');
    assert.deepEqual(csvDraftBoundaryRule.check(architectureFixtures({ ...provider, 'src/stores/csv-editor.store.ts': statement })), []);
  });
}
test('draft observation and save completion have distinct consumers', () => {
  const context = architectureFixtures({
    ...provider,
    'src/app/composables/use-sample.ts': "import {hasCsvTableDraftChanges} from '@/domain/csv-editor/csv-table-draft';",
    'src/orchestrators/csv-save.orchestrator.ts': "import {commitCsvTableSaveDraft} from '@/domain/csv-editor/csv-table-draft';",
  });
  assert.deepEqual(csvDraftBoundaryRule.check(context), []);
});

test('CSV store cannot write a table draft dictionary directly', () => {
  const context = architectureFixtures({
    'src/stores/csv-editor.store.ts': 'const state = { documents: {} }; state.documents[table].dirty[rowKey] = true;',
  });
  const [diagnostic] = csvDraftBoundaryRule.check(context);
  assert.ok(diagnostic);
  assert.equal(diagnostic.ruleId, 'csv-draft-boundary');
  assert.equal(diagnostic.symbol, undefined);
  assert.equal(diagnostic.expected, 'src/domain/csv-editor/csv-table-draft.ts');
});
