import { defineRule } from '../../diagnostics.mjs';
import { moduleDependencyEdges } from '../../facts/module-dependencies.mjs';
export const moduleConsumptionBoundaryRule = defineRule(
  'module-consumption-boundary',
  '.zcode/module-map.md#登记与归属',
  import.meta.url,
  (context, report) => {
    const declarations = new Map(
      context.documents.map((file) => [file.rel, file.document.references.filter((reference) => reference.group === '消费')]),
    );
    for (const edge of moduleDependencyEdges(context)) {
      const references = declarations.get(edge.source) ?? [];
      if (!references.some(({ path }) => edge.resolved === path || edge.resolved.startsWith(path.replace(/\/$/, '') + '/')))
        report({ rel: edge.file }, edge, 'module imports must consume a declared public entry in ' + edge.source, {
          target: edge.resolved,
          symbol: edge.symbol,
          expected: edge.source + '#消费',
        });
    }
  },
);
