import { defineRule } from '../../../diagnostics.mjs';

const gridEntry = 'src/app/components/csv-editor/CsvGrid.vue';

export const csvModuleBoundaryRule = defineRule(
  'csv-module-boundary',
  '.zcode/modules/csv-editor.md#边界',
  import.meta.url,
  (context, report) => {
    const file = context.byPath.get(gridEntry);
    if (!file) return;
    if (file.frontend.tags.has('n-select') || file.frontend.tags.has('NSelect'))
      report(
        file,
        /** @type {import('../../../diagnostics.mjs').Position} */ (
          file.frontend.tags.get('n-select') ?? file.frontend.tags.get('NSelect')
        ),
        'CSV Grid must use CsvCellPicker for cell selection',
        { expected: 'CsvCellPicker' },
      );
    for (const edge of file.dependencies)
      if (!edge.typeOnly && edge.specifier === 'naive-ui' && edge.bindings.some((binding) => binding.importedName === 'NSelect'))
        report(file, edge, 'CSV Grid must consume its cell picker', { target: edge.resolved, expected: 'CsvCellPicker' });
    for (const call of file.calls)
      if (/^(?:revertChanges|saveAll[A-Za-z0-9_]*Csv|saveCsvTables)$/.test(call.localName ?? ''))
        report(file, call, 'CSV actions must stay scoped to the active table', {
          symbol: call.localName ?? 'CSV action',
          expected: 'active table action',
        });
  },
);
