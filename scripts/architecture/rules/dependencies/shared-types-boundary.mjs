import { defineRule } from '../../diagnostics.mjs';
import { classifyFrontendPath } from '../../facts/classify.mjs';

export const sharedTypesBoundaryRule = defineRule(
  'shared-types-boundary',
  '.zcode/overview.md#公共文件',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      const ownsTypes = file.role.layer === 'shared' && file.role.domain === 'types';
      for (const edge of file.dependencies) {
        const target = classifyFrontendPath(edge.resolved);
        if (target.layer !== 'shared' || target.domain !== 'types') continue;
        if (ownsTypes && !file.rel.endsWith('/index.ts') && edge.resolved.endsWith('/index.ts'))
          report(file, edge, 'shared type ownership files must consume concrete type files', {
            target: edge.resolved,
            expected: 'concrete shared type ownership file',
          });
        if (!ownsTypes && !edge.resolved.endsWith('/index.ts'))
          report(file, edge, 'shared types must be consumed through the unified barrel', {
            target: edge.resolved,
            expected: 'shared type barrel',
          });
      }
    }
  },
);
