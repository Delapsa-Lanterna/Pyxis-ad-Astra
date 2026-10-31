import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { collectRepoPaths } from '../../shared/files.mjs';
import { prepareArchitectureFiles } from './imports.mjs';
import { frontendFile, specFile } from './classify.mjs';
import { productionRustSource, rustFacts } from './rust.mjs';
import { serviceExportsFromSource } from './rust-crate-paths.mjs';
import { moduleFacts, moduleMapFacts } from './modules.mjs';

/** @typedef {import('./imports.mjs').ResolvedFile & {rust: import('./rust.mjs').RustFacts, document: import('./modules.mjs').ModuleFacts}} ArchitectureFile */
/** @typedef {{files: readonly ArchitectureFile[], byPath: ReadonlyMap<string, ArchitectureFile>, paths: ReadonlySet<string>, frontend: readonly ArchitectureFile[], rust: readonly ArchitectureFile[], documents: readonly ArchitectureFile[], failures: import('../diagnostics.mjs').Diagnostic[], moduleMap: ReturnType<typeof moduleMapFacts>, registeredRules: readonly import('../diagnostics.mjs').ArchitectureRule[], counts: {frontend: number, rust: number, documents: number}}} ArchitectureContext */
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.rs', '.ts', '.tsx', '.vue']);

/** @param {import('../../shared/files.mjs').SourceFile[]} sources @param {string[]} [available] @returns {ArchitectureContext} */
export function architectureContext(sources, available = sources.map((file) => file.rel)) {
  const prepared = prepareArchitectureFiles(sources, available);
  const rustCode = new Map(
    prepared
      .filter((file) => file.rel.endsWith('.rs'))
      .map((file) => [
        file.rel,
        /_tests?\.rs$/.test(file.rel)
          ? ' '.repeat(file.text.length)
          : productionRustSource(file.rel === 'src-tauri/src/io/work.rs' ? file.text.replace('#![cfg(test)]', ' '.repeat(13)) : file.text),
      ]),
  );
  const exports = serviceExportsFromSource(rustCode.get('src-tauri/src/services/mod.rs') ?? '');
  const files = prepared.map((file) => ({
    ...file,
    rust: rustCode.has(file.rel)
      ? rustFacts(file, /** @type {string} */ (rustCode.get(file.rel)), exports)
      : { code: '', references: [], functions: [], calls: [] },
    document: file.rel.endsWith('.md') ? moduleFacts(file.text) : { lines: [], headings: [], references: [], styleLines: [] },
  }));
  const frontend = files.filter((file) => frontendFile(file.rel) && !specFile(file.rel));
  const rust = files.filter((file) => file.rel.endsWith('.rs'));
  const documents = files.filter((file) => file.rel.startsWith('.zcode/modules/') && file.rel.endsWith('.md'));
  return {
    files,
    registeredRules: [],
    byPath: new Map(files.map((file) => [file.rel, file])),
    paths: files[0]?.repositoryPaths ?? new Set(available),
    frontend,
    rust,
    documents,
    moduleMap: moduleMapFacts(files, files[0]?.repositoryPaths ?? new Set(available)),
    failures: files.flatMap((file) =>
      file.dependencyFailures.map((failure) => ({
        ruleId: 'source-resolution',
        file: file.rel,
        ...failure,
        reference: '.zcode/modules/static-checks.md#规范',
        source: 'scripts/architecture/facts/imports.mjs',
      })),
    ),
    counts: {
      frontend: prepared.reduce((count, file) => count + file.parses.frontend, 0),
      rust: rust.length,
      documents: files.filter((file) => file.rel.endsWith('.md')).length,
    },
  };
}

/** @param {string} root @returns {Promise<ArchitectureContext>} */
export async function collectArchitectureContext(root) {
  const available = await collectRepoPaths(root, () => true, true);
  const paths = available.filter((file) => {
    const extension = extname(file.rel);
    return (
      !file.rel.endsWith('/') &&
      !file.rel.startsWith('.zcode/plans/') &&
      !specFile(file.rel) &&
      ((sourceExtensions.has(extension) &&
        (file.rel.startsWith('src/') || file.rel.startsWith('src-tauri/') || file.rel.startsWith('scripts/architecture/rules/'))) ||
        file.rel === 'tsconfig.json' ||
        file.rel === '.zcode/module-map.md' ||
        (file.rel.startsWith('.zcode/modules/') && extension === '.md'))
    );
  });
  const sources = await Promise.all(paths.map(async (file) => ({ ...file, text: await readFile(file.path, 'utf8') })));
  return architectureContext(
    sources,
    available.map((file) => file.rel),
  );
}
