import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../shared/check-fixtures.mjs';
import { editorModuleBoundaryRule } from './rules/editor-module-boundary.mjs';

test('a spec session consumes the shared definition interface', () => {
  const files = architectureFixtures({
    'src/app/composables/spec-editor/use-spec-editor-window-view-model.ts':
      "import type { SpecEditorDefinition } from './spec-editor.types';",
    'src/app/composables/spec-editor/spec-editor.types.ts': 'export interface SpecEditorDefinition {}',
  });
  assert.deepEqual(editorModuleBoundaryRule.check(files), []);
});
test('the shared spec session rejects every business reader and the application assembly', () => {
  for (const target of [
    'src/services/spec-ship-editor.service.ts',
    'src/services/spec-weapon-editor.service.ts',
    'src/services/spec-projectile-editor.service.ts',
    'src/services/spec-system-editor.service.ts',
    'src/app/composables/spec-editor-assembly.ts',
  ]) {
    for (const type of ['', 'type ']) {
      const files = architectureFixtures({
        'src/app/composables/spec-editor/use-spec-editor-window-view-model.ts': `import ${type}{ read } from '@/${target.slice(4, -3)}';`,
        [target]: 'export function read() {}',
      });
      assert.equal(editorModuleBoundaryRule.check(files).length, 1);
    }
  }
});
test('weapon reads separate catalogue access from projectile detail consumption', () => {
  const files = architectureFixtures({
    'src/services/spec-weapon-editor.service.ts': "const catalogue = querySessionEntityList(sessionId, 'projectile');",
    'src/services/weapon-data.service.ts': "const detail = querySessionEntity(sessionId, 'projectile', id);",
  });
  assert.deepEqual(editorModuleBoundaryRule.check(files), [
    'src/services/weapon-data.service.ts: projectile details belong to their consuming editor or fire preview',
  ]);
});

test('projectile effect layers have one shared drawing owner', () => {
  const files = architectureFixtures({
    'src/app/renderers/editors/projectile-renderer.ts': "images.image('projectileBody');",
    'src/app/renderers/spec-editor/projectile/spec-projectile-scene.ts': "images.image('projectileBody');",
  });
  assert.deepEqual(editorModuleBoundaryRule.check(files), [
    'src/app/renderers/spec-editor/projectile/spec-projectile-scene.ts: projectile effect layers must belong to the shared projectile renderer',
  ]);
});
