import { defineRule } from '../../../diagnostics.mjs';
import { classifyFrontendPath } from '../../../facts/classify.mjs';

export const mainHistoryCommandBoundaryRule = defineRule(
  'main-history-command-boundary',
  '.zcode/modules/main-history-command.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      const shortcut = file.role.layer === 'app' && file.role.domain === 'main-window-shortcuts';
      const dispatcher = file.role.layer === 'orchestrators' && file.role.domain === 'main-history-command';
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
            report(file, property, 'main shortcut composable must delegate keyboard command parsing to domain', {
              symbol: property.name,
              expected: 'keyboard command domain',
            });
      if (shortcut)
        for (const identifier of ['KeyboardEvent', 'EventTarget', 'HTMLElement']) {
          const position = file.frontend.identifiers.get(identifier);
          if (position)
            report(file, position, 'main shortcut composable must delegate keyboard command parsing to domain', {
              symbol: identifier,
              expected: 'keyboard command domain',
            });
        }
      if (dispatcher)
        for (const edge of file.dependencies)
          if (edge.specifier === 'vue')
            report(file, edge, 'main history dispatcher must consume command intent through its caller', {
              target: edge.resolved,
              expected: 'caller-supplied command intent',
            });
      if (dispatcher)
        for (const identifier of ['KeyboardEvent', 'EventTarget', 'HTMLElement']) {
          const position = file.frontend.identifiers.get(identifier);
          if (position)
            report(file, position, 'main history dispatcher must not own keyboard DOM event handling', {
              symbol: identifier,
              expected: 'caller-supplied command intent',
            });
        }
    }
  },
);
