import { defineRule } from '../../../diagnostics.mjs';
import { classifyFrontendPath } from '../../../facts/classify.mjs';

const adapters = new Set(['app/draft-session', 'app/snapshot-history', 'stores/file-history', 'stores/csv-editor']);

export const draftSessionBoundaryRule = defineRule(
  'draft-session-boundary',
  '.zcode/modules/draft-session.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      const current = file.role;
      const owner = current.layer + '/' + current.domain;
      for (const edge of file.dependencies) {
        const target = classifyFrontendPath(edge.resolved);
        if (
          ((current.layer === 'domain' && current.domain === 'edit-session') || owner === 'stores/save-command') &&
          target.domain === 'joint-edit'
        )
          report(file, edge, 'edit session foundations must own target comparison and must not depend on joint editing', {
            target: edge.resolved,
            expected: 'edit session foundation',
          });
        if (edge.typeOnly) continue;
        if (target.domain === 'draft-session' && current.domain !== 'edit-target-draft-session')
          report(file, edge, 'business editing modules must use edit target draft session, not draft session primitive', {
            target: edge.resolved,
            expected: 'edit target draft session',
          });
        const overlapConsumer = owner === 'stores/save-command' || owner === 'orchestrators/edit-target-handoff';
        const onlyComparison = edge.bindings.every((binding) => binding.importedName === 'editTargetsOverlap');
        if (target.layer === 'domain' && target.domain === 'edit-session' && !adapters.has(owner) && !(overlapConsumer && onlyComparison))
          report(file, edge, 'edit session primitives must be consumed through their adapters', {
            target: edge.resolved,
            expected: [...adapters].join(', '),
          });
        if (target.domain === 'json-document-session' && current.role === 'component' && current.domain === 'json-editor')
          report(file, edge, 'JSON editor components must consume editor ViewModel output, not JSON document session', {
            target: edge.resolved,
            expected: 'JSON editor ViewModel',
          });
        if (current.domain === 'edit-target-draft-session' && ['service', 'orchestrator', 'store'].includes(target.role))
          report(file, edge, 'edit target draft session must receive load/save callbacks instead of importing business dependencies', {
            target: edge.resolved,
            expected: 'injected load/save callbacks',
          });
      }
    }
  },
);
