import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { windowBoundaryRule } from './window-boundary.mjs';

for (const name of ['EditorSpecSavedEvent', 'FileEditorSavedEvent'])
  test(name + ' delivers a typed write receipt', () => {
    const legal = architectureFixtures({
      'src/windows/window.events.ts': 'export interface ' + name + ' { writeResult: WriteResult<unknown> }',
    });
    assert.deepEqual(windowBoundaryRule.check(legal), []);
    const invalid = architectureFixtures({ 'src/windows/window.events.ts': '\nexport interface ' + name + ' { changes: string[] }' });
    const [diagnostic] = windowBoundaryRule.check(invalid);
    assert.ok(diagnostic);
    assert.equal(diagnostic.ruleId, 'window-boundary');
    assert.equal(diagnostic.line, 2);
    assert.equal(diagnostic.symbol, name);
    assert.equal(diagnostic.expected, 'writeResult: WriteResult');
  });

test('save event type and raw change fields are checked on the same declaration', () => {
  const invalid = architectureFixtures({
    'src/windows/window.events.ts':
      'export interface EditorSpecSavedEvent { writeResult: unknown; changes: FileChangeRecord[]; unrelated: WriteResult<unknown> }',
  });
  const diagnostics = windowBoundaryRule.check(invalid);
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(diagnostics.map(({ expected }) => expected).sort(), ['WriteResult.changes', 'writeResult: WriteResult'].sort());
});
