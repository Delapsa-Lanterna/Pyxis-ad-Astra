import { posix } from 'node:path';
import ts from 'typescript';
import { parseArchitectureFrontend } from './frontend.mjs';

/** @typedef {import('../../shared/frontend-source.mjs').ImportSpecifierInfo} ImportSpecifierInfo */
/** @typedef {{ specifier: string, resolved: string, typeOnly: boolean, bindings: ImportSpecifierInfo[], line: number, column: number }} ResolvedImport */
/** @typedef {{ rel: string, name: string }} ExportOrigin */
/** @typedef {import('../../shared/files.mjs').SourceFile & ReturnType<typeof parseArchitectureFrontend> & {dependencies: ResolvedImport[], repositoryPaths: ReadonlySet<string>}} ResolvedFile */

/** @param {import('../../shared/files.mjs').SourceFile[]} sources @param {string[]} [available] @returns {ResolvedFile[]} */
export function prepareArchitectureFiles(sources, available = sources.map((file) => file.rel)) {
  const config = sources.find((file) => file.rel === 'tsconfig.json');
  /** @type {Record<string, string[]>} */
  const aliases = config ? configAliases(config) : {};
  const repositoryPaths = new Set(available);
  for (const rel of available) {
    let parent = posix.dirname(rel.endsWith('/') ? rel.slice(0, -1) : rel);
    while (parent !== '.') {
      repositoryPaths.add(parent + '/');
      parent = posix.dirname(parent);
    }
  }
  const files = sources.map((file) => ({
    ...file,
    ...parseArchitectureFrontend(file),
    dependencies: /** @type {ResolvedImport[]} */ ([]),
    repositoryPaths,
  }));
  const paths = new Set(available.filter((rel) => !rel.endsWith('/')));
  for (const file of files) {
    /** @type {Map<string, ResolvedImport>} */
    const edges = new Map();
    const unresolved = new Set();
    for (const binding of file.imports) {
      const resolved = resolveProjectImport(file.rel, binding.specifier, paths, aliases);
      if (resolved === null) {
        const message = {
          line: binding.line,
          column: binding.column,
          message: `internal dependency ${binding.specifier} must resolve to an existing project file`,
          target: binding.specifier,
          symbol: binding.importedName ?? '*',
          expected: 'existing project module',
        };
        if (!unresolved.has(binding.specifier)) file.dependencyFailures.push(message);
        unresolved.add(binding.specifier);
        continue;
      }
      const key = JSON.stringify([resolved, binding.typeOnly]);
      let edge = edges.get(key);
      if (!edge) {
        edge = {
          specifier: binding.specifier,
          resolved,
          typeOnly: binding.typeOnly,
          bindings: [],
          line: binding.line,
          column: binding.column,
        };
        edges.set(key, edge);
      }
      edge.bindings.push(binding);
    }
    file.dependencies = [...edges.values()];
  }
  return files;
}

/** @param {import('../../shared/files.mjs').SourceFile} file @returns {Record<string, string[]>} */
function configAliases(file) {
  const parsed = ts.parseConfigFileTextToJson(file.rel, file.text);
  if (parsed.error) throw new Error(`${file.rel}: ${ts.flattenDiagnosticMessageText(parsed.error.messageText, '\n')}`);
  const base = posix.join(posix.dirname(file.rel), parsed.config.compilerOptions?.baseUrl ?? '.');
  /** @type {Record<string, string[]>} */
  const paths = parsed.config.compilerOptions?.paths ?? {};
  return Object.fromEntries(
    Object.entries(paths).map(([pattern, targets]) => [pattern, targets.map((target) => posix.join(base, target))]),
  );
}

/** @param {import('./context.mjs').ArchitectureFile} file @returns {ImportSpecifierInfo[]} */
export function importSpecifiers(file) {
  return file.imports;
}

/** @param {import('./context.mjs').ArchitectureFile} file @returns {ResolvedImport[]} */
export function importedProjectPaths(file) {
  return file.dependencies;
}

/** @param {string} fromRel @param {string} request @param {Set<string>} paths @param {Record<string, string[]>} aliases @returns {string | null} */
function resolveProjectImport(fromRel, request, paths, aliases) {
  const specifier = request.split(/[?#]/)[0];
  /** @type {string[]} */
  const candidates = [];
  if (specifier.startsWith('.')) candidates.push(posix.join(posix.dirname(fromRel), specifier));
  for (const [pattern, targets] of Object.entries(aliases)) {
    const star = pattern.indexOf('*');
    if (star < 0) {
      if (specifier === pattern) candidates.push(...targets);
    } else {
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (specifier.startsWith(prefix) && specifier.endsWith(suffix)) {
        const captured = specifier.slice(prefix.length, suffix ? -suffix.length : undefined);
        candidates.push(...targets.map((target) => target.replace('*', captured)));
      }
    }
  }
  if (!candidates.length) return specifier;
  for (const candidate of candidates) {
    const path = normalizeProjectPath(candidate);
    const alternatives = [
      path,
      ...['.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.json', '.vue'].map((extension) => path + extension),
      ...['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.vue'].map((extension) => path + '/index' + extension),
    ];
    const found = alternatives.find((target) => paths.has(target));
    if (found) return found;
  }
  return null;
}

/** @param {string} path @returns {string} */
export function normalizeProjectPath(path) {
  return posix.normalize(path.replace(/\\/g, '/'));
}

/** @param {import('./context.mjs').ArchitectureFile} file @returns {string[]} */
export function exportedFunctionNames(file) {
  return file.exportedFunctions;
}

/** @param {ResolvedImport} edge @param {ReadonlyMap<string, import('./context.mjs').ArchitectureFile>} nodes @param {(rel: string, name: string) => boolean} terminal @param {(rel: string) => string[]} [externalNames] @returns {ExportOrigin[]} */
export function dependencyOrigins(edge, nodes, terminal, externalNames = () => []) {
  /** @type {Map<string, ExportOrigin>} */
  const origins = new Map();
  for (const binding of edge.bindings) {
    if (binding.typeOnly || binding.importedName === null) continue;
    for (const origin of exportOrigins(edge.resolved, binding.importedName, nodes, new Set(), terminal, externalNames))
      origins.set(JSON.stringify(origin), origin);
  }
  return [...origins.values()];
}

/** @param {string} rel @param {string} name @param {ReadonlyMap<string, import('./context.mjs').ArchitectureFile>} nodes @param {Set<string>} visiting @param {(rel: string, name: string) => boolean} terminal @param {(rel: string) => string[]} externalNames @returns {ExportOrigin[]} */
function exportOrigins(rel, name, nodes, visiting, terminal, externalNames) {
  if (name !== '*' && terminal(rel, name)) return [{ rel, name }];
  const key = JSON.stringify([rel, name]);
  if (visiting.has(key)) return [];
  const next = new Set(visiting).add(key);
  const file = nodes.get(rel);
  if (!file) return name === '*' ? externalNames(rel).map((name) => ({ rel, name })) : [{ rel, name }];
  if (name === '*')
    return runtimeExportNames(rel, nodes, new Set(), externalNames).flatMap((exportedName) =>
      exportOrigins(rel, exportedName, nodes, next, terminal, externalNames),
    );
  /** @type {ExportOrigin[]} */
  const origins = [];
  const explicit = file.exports.filter((binding) => !binding.typeOnly && binding.exportedName === name);
  const declarations = explicit.length ? explicit : file.exports.filter((binding) => !binding.typeOnly && binding.exportedName === '*');
  for (const declaration of declarations) {
    if (declaration.specifier) {
      const edge = file.dependencies.find(
        (edge) => !edge.typeOnly && edge.bindings.some((binding) => binding.specifier === declaration.specifier),
      );
      if (edge)
        origins.push(
          ...exportOrigins(
            edge.resolved,
            declaration.importedName === '*' && declaration.exportedName === '*' ? name : declaration.importedName,
            nodes,
            next,
            terminal,
            externalNames,
          ),
        );
    } else {
      const imported = file.dependencies
        .flatMap((edge) => edge.bindings.map((binding) => ({ edge, binding })))
        .find(({ binding }) => binding.localName === declaration.localName && !binding.typeOnly);
      if (imported)
        origins.push(
          ...exportOrigins(
            imported.edge.resolved,
            imported.binding.importedName === '*' ? declaration.importedName : (imported.binding.importedName ?? '*'),
            nodes,
            next,
            terminal,
            externalNames,
          ),
        );
      else origins.push({ rel, name: declaration.exportedName });
    }
  }
  if (!declarations.length && name !== '*') origins.push({ rel, name });
  return origins;
}

/** @param {string} rel @param {ReadonlyMap<string, import('./context.mjs').ArchitectureFile>} nodes @param {Set<string>} visiting @param {(rel: string) => string[]} externalNames @returns {string[]} */
function runtimeExportNames(rel, nodes, visiting, externalNames) {
  if (visiting.has(rel)) return [];
  const next = new Set(visiting).add(rel);
  const file = nodes.get(rel);
  if (!file) return externalNames(rel);
  const names = new Set(
    file.exports.filter((binding) => !binding.typeOnly && binding.exportedName !== '*').map((binding) => binding.exportedName),
  );
  for (const declaration of file.exports.filter((binding) => !binding.typeOnly && binding.exportedName === '*')) {
    const edge = file.dependencies.find(
      (edge) => !edge.typeOnly && edge.bindings.some((binding) => binding.specifier === declaration.specifier),
    );
    if (!edge) continue;
    for (const name of runtimeExportNames(edge.resolved, nodes, next, externalNames)) if (name !== 'default') names.add(name);
  }
  return [...names];
}

/** @param {import('./context.mjs').ArchitectureFile} file @param {import('../../shared/frontend-source.mjs').SourceCall | import('../../shared/frontend-source.mjs').SourceAccess} reference @param {ReadonlyMap<string, import('./context.mjs').ArchitectureFile>} nodes @param {ReadonlySet<string>} sources */
function referenceOrigins(file, reference, nodes, sources) {
  const match = file.dependencies
    .filter((edge) => !edge.typeOnly)
    .flatMap((edge) => edge.bindings.map((binding) => ({ edge, binding })))
    .find(({ binding }) => (reference.specifier ? binding.specifier === reference.specifier : binding.localName === reference.localName));
  if (!match) return [];
  const { edge, binding } = match;
  return dependencyOrigins(
    {
      ...edge,
      bindings: [{ ...binding, importedName: reference.factory ? binding.importedName : (reference.member ?? binding.importedName) }],
    },
    nodes,
    (rel) => sources.has(rel),
  )
    .filter((origin) => sources.has(origin.rel))
    .map((origin) => ({ origin, name: reference.factory ? (reference.member ?? origin.name) : origin.name }));
}

/** @param {import('./context.mjs').ArchitectureFile} file @param {ReadonlyMap<string, import('./context.mjs').ArchitectureFile>} nodes @param {ReadonlySet<string>} sources */
export function callsFrom(file, nodes, sources) {
  return file.calls.flatMap((call) => referenceOrigins(file, call, nodes, sources).map((origin) => ({ ...call, ...origin })));
}

/** @param {import('./context.mjs').ArchitectureFile} file @param {ReadonlyMap<string, import('./context.mjs').ArchitectureFile>} nodes @param {ReadonlySet<string>} sources */
export function accessesFrom(file, nodes, sources) {
  return file.accesses.flatMap((access) => referenceOrigins(file, access, nodes, sources).map((origin) => ({ ...access, ...origin })));
}
