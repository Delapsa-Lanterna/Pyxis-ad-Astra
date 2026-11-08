import { pairedSourcePaths } from '../../../shared/files.mjs';
import { defineRule } from '../../diagnostics.mjs';

export const ruleBoundaryRule = defineRule('rule-boundary', '.zcode/modules/static-checks.md#规范', import.meta.url, (context, report) => {
  const identities = new Set();
  for (const rule of context.registeredRules) {
    if (identities.has(rule.name))
      report({ rel: rule.source }, { line: 1, column: 1 }, 'registered rule identities must be unique', {
        symbol: rule.name,
        expected: 'unique rule identity',
      });
    identities.add(rule.name);
    const [reference, anchor] = /** @type {[string, string?]} */ (rule.reference.split('#'));
    const contract = context.byPath.get(reference);
    if (
      anchor &&
      contract &&
      !contract.document.lines.some(
        (line) =>
          /^#{1,6} /.test(line) && line.replace(/^#+ /, '').replace(/\s+/g, '-').toLowerCase() === decodeURIComponent(anchor).toLowerCase(),
      )
    )
      report({ rel: rule.source }, { line: 1, column: 1 }, 'rule references must resolve to an existing contract heading', {
        target: rule.reference,
        expected: 'existing contract heading',
      });
    if (!context.paths.has(reference))
      report({ rel: rule.source }, { line: 1, column: 1 }, 'architecture rules must reference an existing contract', {
        target: reference,
        expected: 'existing contract',
      });
  }
  for (const rel of context.paths) {
    if (!rel.endsWith('.check.mjs')) continue;
    if (context.byPath.has('package.json') && !context.testFiles.has(rel))
      report({ rel }, { line: 1, column: 1 }, 'checker tests must be discovered by test:checks', {
        target: 'package.json',
        expected: 'test:checks discovery',
      });
    if (!pairedSourcePaths(rel).some((source) => context.paths.has(source)))
      report({ rel }, { line: 1, column: 1 }, 'checker tests must be colocated with their implementation', {
        target: rel,
        expected: 'same-directory implementation',
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
