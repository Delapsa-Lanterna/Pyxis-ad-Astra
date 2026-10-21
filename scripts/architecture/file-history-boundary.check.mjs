import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../shared/check-fixtures.mjs';
import { fileHistoryBoundaryRule } from './rules/file-history-boundary.mjs';

test('CSV save accepts the committed baseline before completing history and projection synchronization', () => {
  const files = architectureFixtures({
    'src/orchestrators/csv-save.orchestrator.ts': `
      export async function acceptSavedReceipt(receipt) {
        clearCsvTableHistory(receipt.modRoot, receipt.table);
        await completeSavedWrite(receipt);
      }
    `,
  });
  assert.deepEqual(fileHistoryBoundaryRule.check(files), []);
});

test('saved history and replay state remain owned by their respective orchestrators', () => {
  const files = architectureFixtures({
    'src/app/composables/use-history-actions.ts': `
      pushSavedWriteEntry(receipt);
      commitReplayUndo(receipt);
      replayFileChangeSet(receipt);
    `,
    'src/orchestrators/project-sync.orchestrator.ts': 'pushSavedWriteEntry(receipt);',
    'src/orchestrators/file-history-replay.orchestrator.ts': 'commitReplayUndo(receipt); replayFileChangeSet(receipt);',
  });
  assert.equal(fileHistoryBoundaryRule.check(files).length, 3);
});
