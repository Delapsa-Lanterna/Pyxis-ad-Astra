import { defineRule } from '../../diagnostics.mjs';
import { frontendCapabilities, canConsumeCapability } from '../capabilities/frontend-policy.mjs';

const policySource = 'scripts/architecture/rules/capabilities/frontend-policy.mjs';

export const capabilityContractBoundaryRule = defineRule(
  'capability-contract-boundary',
  '.zcode/modules/static-checks.md#规范',
  import.meta.url,
  (context, report) => {
    if (!context.byPath.has(policySource)) return;
    for (const capability of frontendCapabilities) {
      if (capability.role === 'external') continue;
      const providers = context.frontend.filter(
        (file) =>
          (!capability.path || file.rel === capability.path) &&
          (!capability.layer || file.role.layer === capability.layer) &&
          file.role.role === capability.role &&
          file.role.domain === capability.domain,
      );
      const declaration = context.files.find(
        (file) =>
          file.rel.startsWith('scripts/architecture/rules/') &&
          file.frontend.strings.some((value) => value.value === capability.capability) &&
          file.frontend.strings.some((value) => value.value === capability.domain),
      );
      const position = declaration?.frontend.strings.find((value) => value.value === capability.capability) ?? { line: 1, column: 1 };
      const source = declaration ?? { rel: policySource };
      if (new Set(capability.names).size !== capability.names.length)
        report(source, position, 'capability declarations must list each runtime symbol once', {
          symbol: capability.capability,
          expected: 'unique provider symbols',
        });
      for (const name of capability.names)
        if (!providers.some((file) => file.exports.some((binding) => !binding.typeOnly && binding.exportedName === name)))
          report(source, position, 'capability providers must export their declared runtime symbol', {
            symbol: name,
            target: capability.path ?? capability.domain,
            expected: 'existing runtime export',
          });
      for (const owner of capability.owners)
        if (!context.frontend.some((file) => canConsumeCapability(file.role, { ...capability, owners: [owner] })))
          report(source, position, 'capability consumers must match an existing architecture role', {
            target: owner.path ?? [owner.layer, owner.domain ?? owner.role].join('/'),
            symbol: capability.capability,
            expected: 'existing consumer role',
          });
    }
  },
);
