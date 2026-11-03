import { defineRule } from '../../../diagnostics.mjs';

export const schemaModuleBoundaryRule = defineRule(
  'schema-module-boundary',
  '.zcode/modules/schema.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.rust.filter((file) => file.rel === 'src-tauri/src/domain/csv_column_order.rs')) {
      const sources = file.rust.embeddedAssets;
      if (!sources.length)
        report(file, { line: 1, column: 1 }, 'CSV standard order must derive from column schema declarations', {
          expected: 'schemas/csv/*.schema.json',
        });
      for (const source of sources)
        if (source.path === null || !/^schemas\/csv\/[^/]+\.schema\.json$/.test(source.path))
          report(file, source, 'CSV standard order must derive from column schema declarations', {
            target: source.path ?? source.expression,
            expected: 'schemas/csv/*.schema.json',
          });
    }
    for (const file of context.frontend) {
      if (file.rel === 'src/domain/csv-editor/csv-column-schema.ts')
        for (const edge of file.dependencies)
          if (edge.resolved.endsWith('.json'))
            report(file, edge, 'CSV presentation consumes its authoritative schema registry', {
              target: edge.resolved,
              expected: 'schema registry',
            });
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
