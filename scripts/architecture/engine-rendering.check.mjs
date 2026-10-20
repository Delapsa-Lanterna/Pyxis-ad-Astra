import assert from 'node:assert/strict';
import test from 'node:test';
import { editorModuleBoundaryRule } from './rules/editor-module-boundary.mjs';
import { architectureFixtures } from '../shared/check-fixtures.mjs';

test('engine effects and colors belong to the renderer across editor consumers', () => {
  for (const path of [
    'src/app/components/spec-editor/Ship.vue',
    'src/app/components/immersive/Hull.vue',
    'src/app/composables/editors/use-engine-rendering.ts',
  ]) {
    for (const text of [
      "ctx.drawImage(images['engineGlow'], 0, 0)",
      'const color = style.engineColor',
      "const color=style['engineColor']",
      "ctx.fillStyle='rgb('; // engine tint",
    ]) {
      assert.equal(
        editorModuleBoundaryRule.check(
          architectureFixtures({ [path]: path.endsWith('.vue') ? '<script setup>' + text + '</script>' : text }),
        ).length,
        1,
      );
    }
  }
  assert.deepEqual(
    editorModuleBoundaryRule.check(
      architectureFixtures({
        'src/app/renderers/editors/engine-renderer.ts': "const effect = 'engineGlow'; const color = style.engineColor;",
        'src/app/components/immersive/Hull.vue': '<script setup>drawEngineVisual(ctx, options, images)</script>',
      }),
    ),
    [],
  );
});
