import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { editorQueryBoundaryRule } from './editor-query-boundary.mjs';

test('weapon catalogue and projectile details have distinct query owners', () => {
  const context = architectureFixtures({
    'src/services/entity-query.service.ts': 'export function querySessionEntity() {} export function querySessionEntityList() {}',
    'src/services/spec-weapon-editor.service.ts':
      "import {querySessionEntityList as read} from '@/services/entity-query.service'; read(session, 'projectile');",
    'src/services/weapon-data.service.ts':
      "import {querySessionEntity as read} from '@/services/entity-query.service';\nread(session, 'projectile', id);",
  });
  const diagnostics = editorQueryBoundaryRule.check(context);
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].ruleId, 'editor-query-boundary');
  assert.equal(diagnostics[0].file, 'src/services/weapon-data.service.ts');
  assert.equal(diagnostics[0].line, 2);
  assert.equal(diagnostics[0].symbol, 'querySessionEntity');
});
