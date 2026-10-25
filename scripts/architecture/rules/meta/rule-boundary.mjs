import { defineRule } from '../../diagnostics.mjs';

export const ruleBoundaryRule = defineRule('rule-boundary', '.zcode/modules/static-checks.md#规范', import.meta.url, (context, report) => {
  for (const rule of context.registeredRules) {
    const reference = rule.reference.split('#')[0];
    if (!context.paths.has(reference))
      report({ rel: rule.source }, { line: 1, column: 1 }, 'architecture rules must reference an existing contract', {
        target: reference,
        expected: 'existing contract',
      });
  }
  const sources = new Set(context.registeredRules.map((rule) => rule.source));
  for (const source of sources) {
    const file = context.byPath.get(source);
    if (!file) continue;
    for (const edge of file.dependencies) {
      if (edge.resolved.startsWith('scripts/architecture/rules/') && !edge.resolved.endsWith('.check.mjs')) sources.add(edge.resolved);
      if (
        edge.specifier.startsWith('node:') ||
        edge.resolved.startsWith('scripts/architecture/testing/') ||
        edge.resolved.endsWith('.check.mjs')
      )
        report(file, edge, 'architecture rules must consume repository facts and declared contracts', {
          target: edge.resolved,
          expected: 'repository facts or declared contract',
        });
    }
    for (const property of file.frontend.properties)
      if (property.name === 'text')
        report(file, property, 'architecture rules must consume parsed source facts', {
          symbol: property.name,
          expected: 'parsed source facts',
        });
  }
});
