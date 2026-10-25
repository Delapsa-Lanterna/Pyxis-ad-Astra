import { rules } from './registry.mjs';
import { sortedDiagnostics } from './diagnostics.mjs';

/** @param {import('./facts/context.mjs').ArchitectureContext} context @param {import('./diagnostics.mjs').Diagnostic} diagnostic */
function dependencyKey(context, diagnostic) {
  const file = context.byPath.get(diagnostic.file);
  if (!file) return null;
  const at = (/** @type {{line:number,column:number}} */ edge) => edge.line === diagnostic.line && edge.column === diagnostic.column;
  if (file.dependencies.some(at))
    return JSON.stringify([file.rel, diagnostic.line, diagnostic.column, diagnostic.target, diagnostic.symbol, diagnostic.expected]);
  const rust = file.rust.references.find((edge) => at(edge) && edge.target.join('::') === diagnostic.target?.replace(/^crate::/, ''));
  return rust ? JSON.stringify([file.rel, rust.offset, rust.target]) : null;
}

/** @param {import('./facts/context.mjs').ArchitectureContext} context */
export function checkArchitecture(context) {
  const registered = { ...context, registeredRules: rules };
  const diagnostics = [...context.failures];
  const owners = new Set();
  for (const rule of rules) {
    const results = rule.check(registered).map((diagnostic) => ({ diagnostic, key: dependencyKey(context, diagnostic) }));
    const owned = results.filter((result) => result.key === null || !owners.has(result.key));
    diagnostics.push(...owned.map((result) => result.diagnostic));
    for (const { key } of owned) if (key !== null) owners.add(key);
  }
  return sortedDiagnostics(diagnostics);
}
