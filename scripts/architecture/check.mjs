import { rules } from './registry.mjs';
import { sortedDiagnostics } from './diagnostics.mjs';

/** @param {import('./facts/context.mjs').ArchitectureContext} context */
export function checkArchitecture(context) {
  const registered = { ...context, registeredRules: rules };
  return sortedDiagnostics([...context.failures, ...rules.flatMap((rule) => rule.check(registered))]);
}
