import { defineRule } from '../../diagnostics.mjs';
import { moduleDependencies } from '../../facts/module-dependencies.mjs';
import { dependencyCycles } from '../../facts/dependency-cycles.mjs';

export const moduleImportCycleRule = defineRule(
  'module-import-cycle',
  '.zcode/modules/static-checks.md#规范',
  import.meta.url,
  (context, report) => {
    for (const cycle of dependencyCycles(moduleDependencies(context))) {
      const first = /** @type {import('../../facts/module-dependencies.mjs').ModuleDependency} */ (cycle[0]);
      const chain = [
        ...cycle.map((edge) => context.moduleMap.index.get(edge.source)?.title ?? edge.source),
        context.moduleMap.index.get(first.source)?.title ?? first.source,
      ];
      const evidence = cycle.map((edge) => `${edge.file}:${edge.line}:${edge.column} -> ${edge.resolved}`).join('; ');
      report({ rel: first.file }, first, 'business module import cycle: ' + chain.join(' -> ') + '; ' + evidence, {
        target: first.resolved,
        symbol: chain.join(' -> '),
        expected: 'acyclic business module imports',
      });
    }
  },
);
