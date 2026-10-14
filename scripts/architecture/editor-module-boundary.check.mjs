import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../shared/check-fixtures.mjs';
import { editorModuleBoundaryRule } from './rules/editor-module-boundary.mjs';

test('a spec session consumes the shared definition interface', () => {
  const files = architectureFixtures({
    'src/app/composables/editors/use-editor-window-view-model.ts': "import type { SpecEditorDefinition } from './spec-editor-definitions';",
    'src/app/composables/editors/spec-editor-definitions.ts': 'export interface SpecEditorDefinition {}',
  });
  assert.deepEqual(editorModuleBoundaryRule.check(files), []);
});
test('the shared spec session rejects business dependencies', () => {
  const files = architectureFixtures({
    'src/app/composables/editors/use-editor-window-view-model.ts': "import { read } from '@/services/weapon-editor.service';",
    'src/services/weapon-editor.service.ts': 'export function read() {}',
  });
  assert.equal(editorModuleBoundaryRule.check(files).length, 1);
});
test('weapon reads separate catalogue access from projectile detail consumption', () => {
  const files = architectureFixtures({
    'src/services/weapon-editor.service.ts': "const catalogue = querySessionEntityList(sessionId, 'projectile');",
    'src/services/weapon-data.service.ts': "const detail = querySessionEntity(sessionId, 'projectile', id);",
  });
  assert.deepEqual(editorModuleBoundaryRule.check(files), [
    'src/services/weapon-data.service.ts: projectile details belong to their consuming editor or fire preview',
  ]);
});
