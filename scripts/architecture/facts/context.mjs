import { readFile } from 'node:fs/promises';
import { extname, matchesGlob } from 'node:path';
import { collectRepoPaths } from '../../shared/files.mjs';
import { prepareArchitectureFiles } from './imports.mjs';
import { frontendFile, specFile } from './classify.mjs';
import { productionRustSource, rustFacts } from './rust.mjs';
import { serviceExportsFromSource } from './rust-crate-paths.mjs';
import { moduleFacts, moduleMapFacts } from './modules.mjs';
import { performance } from 'node:perf_hooks';

/** @typedef {import('./imports.mjs').ResolvedFile & {rust: import('./rust.mjs').RustFacts, document: import('./modules.mjs').ModuleFacts}} ArchitectureFile */
/** @typedef {{files: readonly ArchitectureFile[], byPath: ReadonlyMap<string, ArchitectureFile>, paths: ReadonlySet<string>, frontend: readonly ArchitectureFile[], rust: readonly ArchitectureFile[], documents: readonly ArchitectureFile[], testFiles: ReadonlySet<string>, failures: import('../diagnostics.mjs').Diagnostic[], moduleMap: ReturnType<typeof moduleMapFacts>, registeredRules: readonly import('../diagnostics.mjs').ArchitectureRule[], counts: {frontend: number, rust: number, documents: number}}} ArchitectureContext */
const sourceExtensions = new Set(['.js', '.jsx', '.mjs', '.rs', '.ts', '.tsx', '.vue']);

/** @typedef {{stage:string,durationMs:number,units?:number}} ContextTiming */
/** @typedef {{onStageTiming?:(timing:ContextTiming)=>void}} ContextOptions */

/** @param {ContextOptions} options @param {string} stage @param {number} started */
function recordStage(options, stage, started) {
  options.onStageTiming?.({ stage, durationMs: performance.now() - started });
}

/** @param {import('../../shared/files.mjs').SourceFile[]} sources @param {string[]} [available] @param {ContextOptions} [options] @returns {ArchitectureContext} */
export function architectureContext(sources, available = sources.map((file) => file.rel), options = {}) {
  const prepared = prepareArchitectureFiles(sources, available, options);
  let started = performance.now();
  const rustCode = new Map(
    prepared
      .filter((file) => file.rel.endsWith('.rs'))
      .map((file) => [
        file.rel,
        /_tests?\.rs$/.test(file.rel)
          ? ' '.repeat(file.text.length)
          : productionRustSource(
              file.rel === 'src-tauri/src/test_support/work_counts.rs' ? file.text.replace('#![cfg(test)]', ' '.repeat(13)) : file.text,
            ),
      ]),
  );
  const exports = serviceExportsFromSource(rustCode.get('src-tauri/src/services/mod.rs') ?? '');
  recordStage(options, 'rustMaskingAndExportsMs', started);
  started = performance.now();
  const rustFactsByPath = new Map(
    prepared
      .filter((file) => rustCode.has(file.rel))
      .map((file) => [file.rel, rustFacts(file, /** @type {string} */ (rustCode.get(file.rel)), exports)]),
  );
  recordStage(options, 'rustFactsMs', started);
  started = performance.now();
  const documentsByPath = new Map(prepared.filter((file) => file.rel.endsWith('.md')).map((file) => [file.rel, moduleFacts(file.text)]));
  recordStage(options, 'moduleDocumentFactsMs', started);
  const files = prepared.map((file) => ({
    ...file,
    rust: rustFactsByPath.get(file.rel) ?? { code: '', references: [], functions: [], calls: [], embeddedAssets: [] },
    document: documentsByPath.get(file.rel) ?? { lines: [], headings: [], references: [], styleLines: [] },
  }));
  const frontend = files.filter((file) => frontendFile(file.rel) && !specFile(file.rel));
  const rust = files.filter((file) => file.rel.endsWith('.rs'));
  const documents = files.filter((file) => file.rel.startsWith('.zcode/modules/') && file.rel.endsWith('.md'));
  const packageFile = sources.find((file) => file.rel === 'package.json');
  const testCommand = packageFile ? JSON.parse(packageFile.text).scripts['test:checks'] : '';
  const testPatterns = [...testCommand.matchAll(/["']([^"']+\.check\.mjs)["']/g)].map((match) => match[1]);
  started = performance.now();
  const moduleMap = moduleMapFacts(files, files[0]?.repositoryPaths ?? new Set(available));
  recordStage(options, 'moduleMapFactsMs', started);
  started = performance.now();
  const testFiles = new Set(available.filter((rel) => testPatterns.some((pattern) => matchesGlob(rel, pattern))));
  const byPath = new Map(files.map((file) => [file.rel, file]));
  const failures = files.flatMap((file) =>
    file.dependencyFailures.map((failure) => ({
      ruleId: 'source-resolution',
      file: file.rel,
      ...failure,
      reference: '.zcode/modules/static-checks.md#规范',
      source: 'scripts/architecture/facts/imports.mjs',
    })),
  );
  const counts = {
    frontend: prepared.reduce((count, file) => count + file.parses.frontend, 0),
    rust: rust.length,
    documents: files.filter((file) => file.rel.endsWith('.md')).length,
  };
  recordStage(options, 'contextIndexesAndFailuresMs', started);
  return {
    files,
    registeredRules: [],
    byPath,
    paths: files[0]?.repositoryPaths ?? new Set(available),
    frontend,
    rust,
    documents,
    testFiles,
    moduleMap,
    failures,
    counts,
  };
}

/** @param {string} root @param {ContextOptions} [options] @returns {Promise<ArchitectureContext>} */
export async function collectArchitectureContext(root, options = {}) {
  let started = performance.now();
  const available = await collectRepoPaths(root, () => true, true);
  recordStage(options, 'repositoryPathWalkMs', started);
  started = performance.now();
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
        (file.rel.startsWith('.zcode/') && !file.rel.startsWith('.zcode/plans/') && extension === '.md') ||
        file.rel === 'package.json')
    );
  });
  recordStage(options, 'sourceSelectionMs', started);
  started = performance.now();
  const sources = await Promise.all(paths.map(async (file) => ({ ...file, text: await readFile(file.path, 'utf8') })));
  recordStage(options, 'sourceReadMs', started);
  return architectureContext(
    sources,
    available.map((file) => file.rel),
    options,
  );
}
