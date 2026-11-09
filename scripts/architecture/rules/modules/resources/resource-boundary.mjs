import { defineRule } from '../../../diagnostics.mjs';
import { resourceRefObjects } from '../../../facts/resource-refs.mjs';

export const resourceBoundaryRule = defineRule(
  'resource-boundary',
  '.zcode/modules/assets-core-fallback.md#规范',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      if (file.role.layer === 'shared') continue;
      for (const reference of resourceRefObjects(file, context.byPath))
        report(file, reference, 'ResourceRef objects are backend query output; frontend must consume authorized references', {
          expected: 'backend ResourceRef',
        });
    }
  },
);
