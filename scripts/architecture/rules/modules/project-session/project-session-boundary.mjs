import { defineRule } from '../../../diagnostics.mjs';
import { classifyFrontendPath } from '../../../facts/classify.mjs';
import { callsFrom } from '../../../facts/imports.mjs';

const projectSources = new Set(['src/stores/project.store.ts']);
const mutationNames = new Set(['registerProjectManifest', 'replaceProjectManifest', 'removeProjectManifest']);
const mutationOwners = new Set([
  'stores/project',
  'orchestrators/workspace-opening',
  'orchestrators/project-sync',
  'orchestrators/workspace-lifecycle',
  'app/workspace-shell-actions',
]);
const summaries = new Set(['entitySummaries', 'tableSummaries', 'tableEntitySummaries']);

export const projectSessionBoundaryRule = defineRule(
  'project-session-boundary',
  '.zcode/modules/project-session.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      const owner = file.role.layer + '/' + file.role.domain;
      for (const edge of file.dependencies) {
        const target = classifyFrontendPath(edge.resolved);
        if (owner === 'stores/project' && target.layer === 'stores' && target.domain === 'workspace')
          report(file, edge, 'project manifests must be independent of workspace selection', {
            target: edge.resolved,
            expected: 'workspace-owned selection',
          });
        if (
          owner === 'orchestrators/core-assets' &&
          target.layer === 'stores' &&
          ['project', 'workspace', 'settings'].some((domain) => domain === target.domain)
        )
          report(file, edge, 'Core loading must consume the root supplied by window assembly', {
            target: edge.resolved,
            expected: 'window-supplied Core root',
          });
      }
      const selection = ['activeModRoot', 'activeManifest', 'activeSessionId', 'projectName'].find((name) =>
        file.frontend.identifiers.has(name),
      );
      if (owner === 'stores/project' && selection)
        report(
          file,
          /** @type {import('../../../diagnostics.mjs').Position} */ (file.frontend.identifiers.get(selection)),
          'active project projection must be owned by workspace',
          { symbol: selection, expected: 'workspace' },
        );
      for (const call of callsFrom(file, context.byPath, projectSources))
        if (mutationNames.has(call.name) && !mutationOwners.has(owner))
          report(file, call, 'ProjectManifest mutation must be owned by ProjectSession open/remove/refresh boundaries', {
            target: call.origin.rel,
            symbol: call.name,
            expected: [...mutationOwners].join(', '),
          });
      if (file.role.layer === 'app')
        for (const property of file.frontend.properties)
          if (summaries.has(property.name))
            report(file, property, 'app ViewModels must consume project query output', {
              symbol: property.name,
              expected: 'project query output',
            });
    }
  },
);
