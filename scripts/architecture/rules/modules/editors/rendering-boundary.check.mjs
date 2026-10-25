import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { renderingBoundaryRule } from './rendering-boundary.mjs';

for (const [code, symbol] of [
  ["images.image('projectileBody');", 'projectileBody'],
  ["ctx.drawImage(images['engineGlow'],0,0);", 'engineGlow'],
  ['const color=style.engineColor;', 'engineColor'],
  ["const color=style['engineColor'];", 'engineColor'],
]) {
  test('rendering ownership is source positioned for ' + code, () => {
    const context = architectureFixtures({ 'src/app/composables/editors/use-sample.ts': '\n' + code });
    const [diagnostic] = renderingBoundaryRule.check(context);
    assert.equal(diagnostic.ruleId, 'rendering-boundary');
    assert.equal(diagnostic.line, 2);
    assert.equal(diagnostic.symbol, symbol);
  });
}
test('formal renderers own their layers and consumers use drawing operations', () => {
  const context = architectureFixtures({
    'src/app/renderers/editors/projectile-renderer.ts': "images.image('projectileBody');",
    'src/app/renderers/editors/engine-renderer.ts': "images.image('engineGlow'); const color=style.engineColor;",
    'src/app/components/immersive/Hull.vue': '<script setup>drawEngineVisual(ctx, options, images);</script>',
  });
  assert.deepEqual(renderingBoundaryRule.check(context), []);
});

test('engine rendering composables cannot create RGB colors locally', () => {
  const files = architectureFixtures({
    'src/app/composables/editors/use-engine-rendering.ts': "ctx.fillStyle = 'rgb(1, 2, 3)';",
  });
  const [diagnostic] = renderingBoundaryRule.check(files);
  assert.equal(diagnostic.ruleId, 'rendering-boundary');
  assert.equal(diagnostic.expected, 'engine-renderer');
});
