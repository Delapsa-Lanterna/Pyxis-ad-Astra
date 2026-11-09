import assert from 'node:assert/strict';
import { test } from 'node:test';
import { messages, architectureFixtures } from '../../../testing/fixtures.mjs';
import { editorModuleBoundaryRule } from './editor-module-boundary.mjs';

test('a spec session consumes the shared definition interface', () => {
  const files = architectureFixtures({
    'src/app/composables/spec-editor/use-spec-editor-window-view-model.ts':
      "import type { SpecEditorDefinition } from './spec-editor.types';",
    'src/app/composables/spec-editor/spec-editor.types.ts': 'export interface SpecEditorDefinition {}',
  });
  assert.deepEqual(messages(editorModuleBoundaryRule.check(files)), []);
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
      assert.equal(messages(editorModuleBoundaryRule.check(files)).length, 1);
    }
  }
});

test('barrels retain the originating spec implementation identity', () => {
  const context = architectureFixtures({
    'src/app/composables/spec-editor/use-spec-editor-window-view-model.ts': 'import {read} from "@/app/spec-bridge";',
    'src/app/spec-bridge.ts': 'export {read} from "@/app/composables/spec-ship-editor";',
    'src/app/composables/spec-ship-editor.ts': 'export function read(){}',
  });
  const [diagnostic] = editorModuleBoundaryRule.check(context);
  assert.ok(diagnostic);
  assert.equal(diagnostic.target, 'src/app/composables/spec-ship-editor.ts');
});
