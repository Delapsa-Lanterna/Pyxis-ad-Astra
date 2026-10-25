import { defineRule } from '../../../diagnostics.mjs';

const persistenceCommands = new Set(['load_workspace', 'save_workspace']);

export const workspacePersistenceBoundaryRule = defineRule(
  'workspace-persistence-boundary',
  '.zcode/modules/workspace.md#持久化保存',
  import.meta.url,
  (context, report) => {
    for (const file of context.rust) {
      if (!file.rel.startsWith('src-tauri/src/commands/')) continue;
      for (const fn of file.rust.functions) {
        if (!persistenceCommands.has(fn.name)) continue;
        const edges = file.rust.references.filter(
          (edge) => edge.offset >= fn.start && edge.offset < fn.end && edge.target[0] === 'services',
        );
        if (!edges.length)
          report(file, fn, 'workspace persistence commands must consume Workspace Persistence backend', {
            symbol: fn.name,
            expected: 'services::workspace_persistence',
          });
        for (const edge of edges)
          if (edge.target[1] !== 'workspace_persistence')
            report(file, edge, 'workspace persistence commands must consume Workspace Persistence backend', {
              target: edge.target.join('::'),
              symbol: fn.name,
              expected: 'services::workspace_persistence',
            });
      }
    }
  },
);
