import { rules } from './registry.mjs';
import { sortedDiagnostics } from './diagnostics.mjs';
import { performance } from 'node:perf_hooks';

/** @typedef {{ruleId:string,durationMs:number}} RuleTiming */
/** @param {import('./facts/context.mjs').ArchitectureContext} context @param {{onRuleTiming?:(sample:RuleTiming)=>void}} [options] */
export function checkArchitecture(context, options = {}) {
  const registered = { ...context, registeredRules: rules };
  const diagnostics = [...context.failures];
  for (const rule of rules) {
    const started = performance.now();
    diagnostics.push(...rule.check(registered));
    options.onRuleTiming?.({ ruleId: rule.name, durationMs: performance.now() - started });
  }
  return sortedDiagnostics(diagnostics);
}
