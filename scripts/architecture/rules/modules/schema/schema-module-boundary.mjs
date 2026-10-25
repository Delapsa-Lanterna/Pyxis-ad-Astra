import { defineRule } from '../../../diagnostics.mjs';

export const schemaModuleBoundaryRule = defineRule(
  'schema-module-boundary',
  '.zcode/modules/schema.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      const component = file.role.layer === 'app' && file.role.role === 'component' && file.role.domain === 'schema';
      const dispatch = component && file.frontend.conditions.find((condition) => /\b(?:field|active)\.type\b/.test(condition.expression));
      if (
        dispatch &&
        !file.frontend.conditions.some((condition) => /\b(?:plainMode|mode|settings\.isPlainEditMode)\b/.test(condition.expression))
      )
        report(file, dispatch, 'schema field rendering must cover plain text and enhanced edit modes');
      if (file.role.layer === 'shared' && file.role.domain === 'types')
        for (const declaration of file.frontend.declarations)
          if (declaration.name === 'SchemaRuntimeContext')
            report(file, declaration, 'SchemaRuntimeContext belongs to schema runtime domain', {
              symbol: declaration.name,
              expected: 'schema runtime domain',
            });
      if (component)
        for (const token of [
          'querySourceOptions',
          'subscribeSourceOptionInvalidation',
          'sourceOptionsRequestId',
          'pickFileDialog',
          'pathBelongsToRoot',
          'relativePathFromRoot',
          'resolveSource',
        ]) {
          const position = file.frontend.identifiers.get(token);
          if (position)
            report(file, position, 'schema field renderer must delegate source and path behavior to schema runtime composables', {
              symbol: token,
              expected: 'schema runtime composables',
            });
        }
      const assets = file.dependencies.filter((edge) => edge.resolved.startsWith('schemas/') && edge.resolved.endsWith('.schema.json'));
      if (assets.length && (file.role.layer !== 'domain' || file.role.domain !== 'schema'))
        for (const edge of assets)
          report(file, edge, 'schema assets must be loaded by schema domain registries', {
            target: edge.resolved,
            expected: 'schema registry',
          });
      if (assets.length)
        for (const binding of file.exports)
          if (!binding.typeOnly && !['getSchema', 'getCsvColumnSchemas'].includes(binding.exportedName))
            report(file, binding, 'schema registry must export its registry lookup entries', {
              symbol: binding.exportedName,
              expected: 'getSchema or getCsvColumnSchemas',
            });
    }
  },
);
