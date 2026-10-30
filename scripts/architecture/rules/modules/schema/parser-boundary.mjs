import { defineRule } from '../../../diagnostics.mjs';
import { modulePartsFromRel } from '../../../facts/rust-crate-paths.mjs';

const toolJson = new Set([
  'domain::well_known_labels',
  'domain::spec_construction',
  'domain::csv_column_order',
  'services::app_settings',
  'services::workspace_persistence',
]);

export const parserBoundaryRule = defineRule(
  'parser-boundary',
  '.zcode/modules/text-parsers.md#规范',
  import.meta.url,
  (context, report) => {
    for (const file of context.rust) {
      const parts = modulePartsFromRel(file.rel);
      const role = /** @type {string} */ (parts[0]);
      const owner = parts.slice(0, 2).join('::');
      const csvWrite =
        ['services::config_entity', 'services::json_file', 'services::spec_editor'].includes(owner) ||
        parts.slice(0, 3).join('::') === 'services::project::write';
      for (const edge of file.rust.references) {
        const target = edge.target.join('::');
        if (target === 'serde_json::from_str' && role !== 'parsers' && !toolJson.has(owner))
          report(file, edge, 'Mod JSON-like reads must go through alex_json IO/parser boundary', { target, expected: 'alex_json parser' });
        if (target === 'parsers::parse_csv_bytes' && !['parsers', 'io'].includes(role))
          report(file, edge, 'CSV bytes must be parsed through CSV IO or alex_csv parser tests', { target, expected: 'CSV IO' });
        if (target === 'parsers::render_csv_text' && role !== 'parsers' && !csvWrite)
          report(file, edge, 'CSV text rendering belongs to CSV/config write boundaries', { target, expected: 'CSV write boundary' });
      }
    }
  },
);
