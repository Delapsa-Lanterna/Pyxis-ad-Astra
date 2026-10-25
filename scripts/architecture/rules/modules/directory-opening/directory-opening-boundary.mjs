import { defineRule } from '../../../diagnostics.mjs';

const directoryCommands = new Set(['detect_directory', 'scan_game_overview']);
const openingModelTypes = new Set(['OpenDirectoryResult', 'OpenDirectoryKind', 'GameOverviewData', 'GameModSummary', 'GameScanWarning']);

export const directoryOpeningBoundaryRule = defineRule(
  'directory-opening-boundary',
  '.zcode/modules/directory-opening.md#边界',
  import.meta.url,
  (context, report) => {
    for (const file of context.rust) {
      if (file.rel.startsWith('src-tauri/src/models/') && !file.rel.endsWith('/directory_opening.rs'))
        for (const match of file.rust.code.matchAll(/\b(?:struct|enum)\s+([A-Za-z0-9_]+)/g))
          if (openingModelTypes.has(match[1]))
            report(file, { line: 1, column: 1 }, 'Directory Opening wire models must live in models/directory_opening.rs', {
              symbol: match[1],
              expected: 'src-tauri/src/models/directory_opening.rs',
            });
      if (!file.rel.startsWith('src-tauri/src/commands/')) continue;
      for (const fn of file.rust.functions) {
        if (!directoryCommands.has(fn.name)) continue;
        const targets = file.rust.references.filter(
          (edge) => edge.offset >= fn.start && edge.offset < fn.end && edge.target[0] === 'services',
        );
        for (const edge of targets)
          if (edge.target[1] !== 'directory_opening')
            report(file, edge, 'directory commands must consume Directory Opening backend', {
              target: edge.target.join('::'),
              symbol: fn.name,
              expected: 'services::directory_opening',
            });
        if (!targets.length)
          report(file, fn, 'directory commands must consume Directory Opening backend', {
            symbol: fn.name,
            expected: 'services::directory_opening',
          });
      }
    }
  },
);
