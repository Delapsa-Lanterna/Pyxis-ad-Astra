import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFrontendPath } from './classify.mjs';

test('classification expresses flat domain and actual responsibility suffixes consistently', () => {
  assert.equal(classifyFrontendPath('src/domain/edit-session.ts').domain, 'edit-session');
  assert.equal(classifyFrontendPath('src/services/csv-table.service.ts').domain, 'csv-table');
  assert.equal(classifyFrontendPath('src/services/text-editor.service.ts').domain, 'text-editor');
  assert.equal(classifyFrontendPath('src/orchestrators/csv-save.orchestrator.ts').domain, 'csv-save');
  assert.equal(classifyFrontendPath('scripts/architecture/testing/fixtures.mjs').role, 'fixture');
  assert.equal(classifyFrontendPath('scripts/shared/rust-source.check.mjs').layer, 'test');
  assert.equal(classifyFrontendPath('src/domain/sample.spec.mjs').layer, 'test');
});
