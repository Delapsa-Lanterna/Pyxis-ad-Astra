import { defineRule } from '../../../diagnostics.mjs';
import { dependencyOrigins } from '../../../facts/imports.mjs';

const draftSource = 'src/domain/csv-editor/csv-table-draft.ts';
const readOperations = new Set(['csvRowTargetOf', 'csvVisibleRowKeys', 'hasCsvTableDraftChanges', 'hasCsvRowOrderChanges']);
const mutationOwners = new Set(['stores/csv-editor', 'domain/csv-editor']);

export const csvDraftBoundaryRule = defineRule(
  'csv-draft-boundary',
  '.zcode/modules/csv-editor.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      const owner = file.role.layer + '/' + file.role.domain;
      if (owner === 'stores/csv-editor') {
        for (const write of file.frontend.writes) {
          if (
            /\.documents\[[^\]]+\]\.(?:dirty|rows|rowOrder|baselineRows|baselineRowOrder|nextRowKey|externalUpdatePending)|\.dirty\[[^\]]+\]/.test(
              write.path,
            )
          )
            report(file, write, 'CSV stores must delegate draft state mutations to csv-table-draft', {
              target: write.path,
              expected: 'src/domain/csv-editor/csv-table-draft.ts',
            });
        }
        if (file.calls.some((call) => call.localName === 'Object' && call.member === 'assign'))
          report(file, { line: 1, column: 1 }, 'CSV stores must delegate draft state mutations to csv-table-draft', {
            expected: 'src/domain/csv-editor/csv-table-draft.ts',
          });
      }
      for (const edge of file.dependencies) {
        const mutations = dependencyOrigins(edge, context.byPath, (rel) => rel === draftSource).filter(
          (origin) => origin.rel === draftSource && !readOperations.has(origin.name),
        );
        for (const operation of mutations) {
          const commitOwner = owner === 'orchestrators/csv-save' && operation.name === 'commitCsvTableSaveDraft';
          if (!mutationOwners.has(owner) && !commitOwner)
            report(file, edge, 'CSV draft mutations must be consumed by the CSV runtime or save boundary', {
              target: operation.rel,
              symbol: operation.name,
              expected: 'CSV runtime or save boundary',
            });
        }
      }
    }
  },
);
