import { defineRule } from '../../../diagnostics.mjs';
import { classifyFrontendPath } from '../../../facts/classify.mjs';

export const workspaceHistoryBoundaryRule = defineRule(
  'workspace-history-boundary',
  '.zcode/modules/workspace.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      const shortcut = file.role.layer === 'app' && file.role.domain === 'main-window-shortcuts';
      const dispatcher = file.role.layer === 'orchestrators' && file.role.domain === 'workspace-history';
      if (shortcut)
        for (const edge of file.dependencies) {
          const target = classifyFrontendPath(edge.resolved);
          if (target.layer === 'stores' && ['file-history', 'csv-editor'].some((domain) => domain === target.domain))
            report(file, edge, 'main shortcut composable must consume the history dispatcher', {
              target: edge.resolved,
              expected: 'history dispatcher',
            });
        }
      if (shortcut)
        for (const property of file.frontend.properties)
          if (['ctrlKey', 'metaKey', 'key'].includes(property.name))
            report(file, property, 'main shortcut composable must delegate keyboard command parsing to the keyboard rules', {
              symbol: property.name,
              expected: 'keyboard shortcut rules',
            });
      if (shortcut)
        for (const identifier of ['KeyboardEvent', 'EventTarget', 'HTMLElement']) {
          const position = file.frontend.identifiers.get(identifier);
          if (position)
            report(file, position, 'main shortcut composable must delegate keyboard command parsing to the keyboard rules', {
              symbol: identifier,
              expected: 'keyboard shortcut rules',
            });
        }
      if (dispatcher)
        for (const identifier of ['KeyboardEvent', 'EventTarget', 'HTMLElement', 'onMounted', 'onUnmounted']) {
          const position = file.frontend.identifiers.get(identifier);
          if (position)
            report(file, position, 'workspace history actions must consume caller-supplied command intent', {
              symbol: identifier,
              expected: 'caller-supplied command intent',
            });
        }
    }
  },
);
