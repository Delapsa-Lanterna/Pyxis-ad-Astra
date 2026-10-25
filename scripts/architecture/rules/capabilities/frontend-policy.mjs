import { classifyFrontendPath } from '../../facts/classify.mjs';
import { dependencyOrigins } from '../../facts/imports.mjs';

/** @typedef {import('../../facts/classify.mjs').FrontendPathClass} PathRole */
/** @typedef {{ path?: string, layer: string, domain?: string, role?: string }} Owner */
/** @typedef {{ path?: string, layer?: string, role: string, domain: string, names: string[], capability: string, owners: Owner[] }} CapabilityRule */

import { applicationCapabilities } from '../modules/app-feedback/capabilities.mjs';
import { windowsCapabilities } from '../modules/windowing/capabilities.mjs';
import { projectCapabilities } from '../modules/project-session/capabilities.mjs';
import { editorsCapabilities } from '../modules/editors/capabilities.mjs';
import { resourcesCapabilities } from '../modules/resources/capabilities.mjs';

export const frontendCapabilities = [
  ...applicationCapabilities,
  ...windowsCapabilities,
  ...projectCapabilities,
  ...editorsCapabilities,
  ...resourcesCapabilities,
];

/** @type {Map<string, CapabilityRule[]>} */
const capabilityIndex = new Map();
/** @type {Map<string, string[]>} */
const externalNames = new Map();
for (const rule of frontendCapabilities) {
  for (const name of rule.names) {
    const key = JSON.stringify([rule.role, rule.domain, name]);
    const entries = capabilityIndex.get(key) ?? [];
    entries.push(rule);
    capabilityIndex.set(key, entries);
  }
  if (rule.role === 'external') externalNames.set(rule.domain, [...(externalNames.get(rule.domain) ?? []), ...rule.names]);
}

/** @param {string} rel @param {string} name @param {PathRole} [target] @returns {CapabilityRule | undefined} */
export function capabilityFor(rel, name, target = classifyFrontendPath(rel)) {
  const domain = target.layer === 'external' ? rel : target.domain;
  return capabilityIndex
    .get(JSON.stringify([target.role, domain, name]))
    ?.find(
      (rule) =>
        (rule.path === undefined || rule.path === rel) &&
        (rule.layer === undefined || rule.layer === target.layer) &&
        rule.role === target.role &&
        rule.domain === domain,
    );
}

/** @param {PathRole} role @param {string} rel @returns {boolean} */
export function hasCapabilityBoundary(role, rel) {
  return frontendCapabilities.some(
    (rule) =>
      (rule.path === undefined || rule.path === rel) &&
      (rule.layer === undefined || rule.layer === role.layer) &&
      rule.role === role.role &&
      rule.domain === role.domain,
  );
}

/** @param {import('../../facts/imports.mjs').ResolvedImport} edge @param {ReadonlyMap<string, import('../../facts/context.mjs').ArchitectureFile>} nodes @returns {import('../../facts/imports.mjs').ExportOrigin[]} */
export function capabilityOrigins(edge, nodes) {
  return dependencyOrigins(
    edge,
    nodes,
    (rel, name) => Boolean(capabilityFor(rel, name, nodes.get(rel)?.role)),
    (rel) => externalNames.get(rel) ?? [],
  );
}

/** @param {PathRole} current @param {CapabilityRule} capability @returns {boolean} */
export function canConsumeCapability(current, capability) {
  return capability.owners.some((owner) => matchesOwner(current, owner));
}

/** @param {PathRole} current @param {Owner} owner @returns {boolean} */
function matchesOwner(current, owner) {
  return (
    (owner.path === undefined || current.path === owner.path) &&
    current.layer === owner.layer &&
    (owner.domain === undefined || current.domain === owner.domain) &&
    (owner.role === undefined || current.role === owner.role)
  );
}
