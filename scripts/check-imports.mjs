import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { collectRepoPaths } from './shared/files.mjs';
import { parseFrontendSource } from './shared/frontend-source.mjs';
import { sourcePositions } from './shared/source-position.mjs';
import { formatDiagnostic, sortedDiagnostics } from './architecture/diagnostics.mjs';

/** @param {import('./shared/files.mjs').SourceFile} file */
export function checkInlineTypeImports(file) {
  /** @type {import('./architecture/diagnostics.mjs').Diagnostic[]} */
  const diagnostics = [];
  const at = sourcePositions(file.text);
  parseFrontendSource(file, {
    references: false,
    onNode(node, ast, offset) {
      if (!ts.isImportTypeNode(node)) return;
      diagnostics.push({
        ruleId: 'inline-type-import',
        file: file.rel,
        ...at(offset + node.getStart(ast)),
        message: 'type dependencies must use top-level imports',
        symbol: node.getText(ast),
        expected: 'top-level import type',
        reference: '.zcode/frontend-guidelines.md#类型与分支设计',
        source: 'scripts/check-imports.mjs',
      });
    },
  });
  return diagnostics;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue']);
  const files = await collectRepoPaths(process.cwd(), (rel, extension) => extensions.has(extension) && !rel.startsWith('.zcode/plans/'));
  const diagnostics = sortedDiagnostics(
    (await Promise.all(files.map(async (file) => checkInlineTypeImports({ ...file, text: await readFile(file.path, 'utf8') })))).flat(),
  );
  if (diagnostics.length) {
    console.error(diagnostics.map(formatDiagnostic).join('\n'));
    process.exitCode = 1;
  } else console.log('Inline type import check passed.');
}
