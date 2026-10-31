import { defineRule } from '../../../diagnostics.mjs';
import { accessesFrom } from '../../../facts/imports.mjs';

const gridEntry = 'src/app/components/csv-editor/CsvGrid.vue';
const historySource = new Set(['src/stores/csv-editor.store.ts']);

export const csvModuleBoundaryRule = defineRule(
  'csv-module-boundary',
  '.zcode/modules/csv-editor.md#边界',
  import.meta.url,
  (context, report) => {
    for (const consumer of context.frontend)
      for (const access of accessesFrom(consumer, context.byPath, historySource))
        if (access.name === 'setHistoryLimit' && consumer.rel !== 'src/app/composables/use-app-lifecycle-assembly.ts')
          report(consumer, access, 'CSV history capacity must be connected by window assembly', {
            target: access.origin.rel,
            symbol: access.name,
            expected: 'src/app/composables/use-app-lifecycle-assembly.ts',
          });
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
