import { defineRule } from '../../../diagnostics.mjs';

const projectileLayers = new Set(['projectileTrail', 'projectileBody', 'plasmaRay']);
const engineLayers = new Set(['engineGlow', 'engineFlame', 'engineHitGlow', 'engine-source-atop', 'engine-fallback']);

export const renderingBoundaryRule = defineRule(
  'rendering-boundary',
  '.zcode/modules/editor-canvas.md#规范',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      if (file.role.layer !== 'app') continue;
      for (const literal of file.frontend.strings) {
        if (file.role.domain !== 'projectile-renderer' && projectileLayers.has(literal.value))
          report(file, literal, 'projectile effect layers must belong to the shared projectile renderer', {
            symbol: literal.value,
            expected: 'projectile-renderer',
          });
        if (file.role.domain !== 'engine-renderer' && engineLayers.has(literal.value))
          report(file, literal, 'engine effects must delegate layer drawing to the engine renderer', {
            symbol: literal.value,
            expected: 'engine-renderer',
          });
      }
      if (file.role.domain !== 'engine-renderer')
        for (const property of file.frontend.properties)
          if (property.name === 'engineColor')
            report(file, property, 'engine colors must be resolved by the engine renderer', {
              symbol: property.name,
              expected: 'engine-renderer',
            });
      if (file.role.domain !== 'engine-renderer' && file.role.domain?.includes('engine'))
        for (const literal of file.frontend.strings)
          if (/^rgb\s*\(/i.test(literal.value))
            report(file, literal, 'engine colors must be resolved by the engine renderer', {
              symbol: literal.value,
              expected: 'engine-renderer',
            });
    }
  },
);
