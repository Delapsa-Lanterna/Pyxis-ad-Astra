import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectRepoPaths } from './shared/files.mjs';
import { formatDiagnostic, sortedDiagnostics } from './architecture/diagnostics.mjs';
import { moduleFacts, moduleMapFacts } from './architecture/facts/modules.mjs';
import { checkInlineTypeImports, checkMockSources } from './check-frontend-imports.mjs';
import { checkRustImports } from './check-rust-imports.mjs';
import { checkRustModuleBoundaries, rustModuleBoundaryContext } from './check-rust-module-boundaries.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.rs']);
  const paths = await collectRepoPaths(
    process.cwd(),
    (rel, extension) =>
      extensions.has(extension) || rel === '.zcode/module-map.md' || (rel.startsWith('.zcode/modules/') && extension === '.md'),
    true,
  );
  const repositoryPaths = new Set(paths.map(({ rel }) => rel));
  const files = await Promise.all(
    paths
      .filter(({ rel }) => !rel.endsWith('/') && extensions.has(rel.slice(rel.lastIndexOf('.'))))
      .map(async (file) => ({ ...file, text: await readFile(file.path, 'utf8') })),
  );
  const moduleDocs = await Promise.all(
    paths
      .filter(({ rel }) => rel === '.zcode/module-map.md' || (rel.startsWith('.zcode/modules/') && rel.endsWith('.md')))
      .map(async (file) => ({ ...file, text: await readFile(file.path, 'utf8') })),
  );
  const moduleMap = moduleMapFacts(
    moduleDocs.map((file) => ({ ...file, document: moduleFacts(file.text) })),
    repositoryPaths,
  );
  const rustFiles = files.filter((file) => file.rel.endsWith('.rs'));
  const rustContext = rustModuleBoundaryContext(rustFiles, moduleMap.owners);
  const diagnostics = sortedDiagnostics([
    ...(await checkMockSources(files, process.cwd())),
    ...files.flatMap((file) =>
      file.rel.endsWith('.rs')
        ? [...checkRustImports(file), ...checkRustModuleBoundaries(file, rustContext)]
        : checkInlineTypeImports(file),
    ),
  ]);
  if (diagnostics.length) {
    console.error(diagnostics.map(formatDiagnostic).join('\n'));
    process.exitCode = 1;
  } else console.log('Import check passed.');
}
