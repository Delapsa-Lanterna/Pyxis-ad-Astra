import { defineRule } from '../../../diagnostics.mjs';

export const csvValidationColumnsRule = defineRule(
  'csv-validation-columns',
  '.zcode/modules/schema.md#规范',
  import.meta.url,
  (context, report) => {
    for (const file of context.files) {
      const schema = file.csvSchema;
      if (!schema) continue;
      const columns = new Map();
      for (const column of schema.columns) {
        if (columns.has(column.key))
          report(file, column, 'duplicate CSV column declaration', {
            symbol: column.key,
            target: column.key,
            expected: 'unique column key',
          });
        else columns.set(column.key, column.control);
      }
      for (const rule of schema.unknownRules)
        report(file, rule, 'unknown CSV validation declaration', { target: rule.key, expected: 'declared CSV validation rule' });
      for (const ref of schema.references) {
        if (!columns.has(ref.key))
          report(file, ref, 'validation refers to an unknown CSV column', {
            symbol: ref.rule,
            target: ref.rule + '.' + ref.key,
            expected: 'declared column key',
          });
        else if (ref.numeric && columns.get(ref.key) !== 'number')
          report(file, ref, 'numeric validation requires a number control', {
            symbol: ref.rule,
            target: ref.rule + '.' + ref.key,
            expected: 'number',
          });
      }
    }
  },
);
