/** @type {import('./frontend-policy.mjs').Owner[]} */
export const readOwners = [{ layer: 'services' }, { layer: 'orchestrators' }, { layer: 'app', role: 'composable' }];

/** @param {Omit<import('./frontend-policy.mjs').CapabilityRule, 'names' | 'capability' | 'owners'>} provider @param {Pick<import('./frontend-policy.mjs').CapabilityRule, 'names' | 'capability' | 'owners'>[]} entries */
export function capabilities(provider, entries) {
  return entries.map((entry) => ({ ...provider, ...entry }));
}
