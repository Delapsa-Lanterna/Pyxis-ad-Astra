import { defineRule } from '../../../diagnostics.mjs';
import { callsFrom } from '../../../facts/imports.mjs';

const entitySources = new Set(['src/services/entity-query.service.ts']);

export const editorQueryBoundaryRule = defineRule(
  'editor-query-boundary',
  '.zcode/modules/spec-weapon-editor.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      if (file.role.layer !== 'services' || !['spec-weapon-editor', 'weapon-data'].some((domain) => domain === file.role.domain)) continue;
      for (const call of callsFrom(file, context.byPath, entitySources)) {
        if (call.name === 'querySessionEntity' && call.arguments[1] === 'projectile')
          report(file, call, 'projectile details belong to their consuming editor or fire preview', {
            target: call.origin.rel,
            symbol: call.name,
            expected: 'projectile consumer',
          });
      }
    }
  },
);
