import { defineRule } from '../../../diagnostics.mjs';

export const resourceBoundaryRule = defineRule(
  'resource-boundary',
  '.zcode/modules/assets-core-fallback.md#规范',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      if (file.role.layer === 'shared') continue;
      for (const declaration of file.frontend.objects)
        if (declaration.properties.some((name) => name === 'ownerKind' || name === 'ownerId'))
          report(file, declaration, 'ResourceRef objects are backend query output; frontend must consume authorized references', {
            expected: 'backend ResourceRef',
          });
    }
  },
);
