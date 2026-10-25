import { defineRule } from '../../diagnostics.mjs';
import { classifyFrontendPath } from '../../facts/classify.mjs';
import { capabilityFor, capabilityOrigins, hasCapabilityBoundary, canConsumeCapability } from './frontend-policy.mjs';
import { frontendDependencyFailure } from '../dependencies/frontend-policy.mjs';

export const capabilityBoundaryRule = defineRule(
  'capability-boundary',
  '.zcode/modules/static-checks.md#规范',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      if (hasCapabilityBoundary(file.role, file.rel))
        for (const binding of file.exports)
          if (!binding.typeOnly && !capabilityFor(file.rel, binding.exportedName, file.role))
            report(file, binding, binding.exportedName + ': public runtime exports must declare their capability ownership', {
              symbol: binding.exportedName,
              expected: 'declared capability',
            });
      for (const edge of file.dependencies) {
        if (edge.typeOnly || frontendDependencyFailure(file.role, classifyFrontendPath(edge.resolved), edge)) continue;
        /** @type {Map<string, {names: Set<string>, owners: import('./frontend-policy.mjs').Owner[]}>} */
        const rejected = new Map();
        for (const origin of capabilityOrigins(edge, context.byPath)) {
          const capability = capabilityFor(origin.rel, origin.name, context.byPath.get(origin.rel)?.role);
          if (capability && !canConsumeCapability(file.role, capability)) {
            const rejection = rejected.get(capability.capability) ?? { names: new Set(), owners: capability.owners };
            rejection.names.add(origin.name);
            rejected.set(capability.capability, rejection);
          }
        }
        for (const [capability, rejection] of rejected) {
          const owners = rejection.owners
            .map((owner) => owner.path ?? [owner.layer, owner.domain ?? owner.role].filter(Boolean).join('/'))
            .join(', ');
          const names = [...rejection.names].sort().join(', ');
          report(file, edge, capability + ' (' + names + ') must be owned by ' + owners, {
            target: edge.resolved,
            symbol: names,
            expected: owners,
          });
        }
      }
    }
  },
);
