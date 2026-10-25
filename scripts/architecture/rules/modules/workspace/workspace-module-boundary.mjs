import { defineRule } from '../../../diagnostics.mjs';
import { callsFrom, accessesFrom } from '../../../facts/imports.mjs';

const workspaceSources = new Set(['src/stores/workspace.store.ts']);
const activation = new Set(['activateModOverview', 'activateModTable', 'activateModJson', 'activateModFileHistory', 'activateModFiles']);
const stateFields = new Set(['activeModRoot', 'currentView', 'jsonPage']);

export const workspaceModuleBoundaryRule = defineRule(
  'workspace-module-boundary',
  '.zcode/modules/workspace.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      if (file.role.role === 'component')
        for (const call of callsFrom(file, context.byPath, workspaceSources))
          if (activation.has(call.name))
            report(file, call, 'components must activate loaded Mods through workspace navigation actions', {
              target: call.origin.rel,
              symbol: call.name,
              expected: 'workspace navigation actions',
            });
      if (file.role.layer === 'stores' && file.role.domain === 'workspace') continue;
      for (const access of accessesFrom(file, context.byPath, workspaceSources))
        if (access.write && stateFields.has(access.member ?? ''))
          report(file, access, 'workspace state must be changed through workspace domain actions', {
            target: access.origin.rel,
            symbol: access.member ?? 'workspace state',
            expected: 'workspace domain actions',
          });
    }
  },
);
