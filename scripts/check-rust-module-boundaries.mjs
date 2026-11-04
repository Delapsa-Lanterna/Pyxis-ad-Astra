import { splitTopLevel } from './shared/rust-source.mjs';
import { rustImportFacts } from './check-rust-imports.mjs';
import { sourcePositions } from './shared/source-position.mjs';

const technicalExports = new Set([
  'src-tauri/src/commands/mod.rs',
  'src-tauri/src/io/mod.rs',
  'src-tauri/src/models/mod.rs',
  'src-tauri/src/parsers/mod.rs',
]);

/** @typedef {{module: boolean, name: string | null, parent: RustScope | null}} RustScope */
/** @typedef {ReturnType<typeof rustImportFacts>} RustFacts */
/** @typedef {{path: string, rel: string, text: string, facts: RustFacts, owner: string | undefined}} RustSource */
/** @typedef {{modules: Map<string, string>, sources: Map<string, RustSource>, owners: ReadonlyMap<string, string>}} RustModuleBoundaryContext */
/** @typedef {{file: string, owner: string | undefined, itemKind: string | null, module: boolean, hops: number}} RustTarget */
/** @typedef {{path: string[], alias: string, wildcard: boolean}} RustUseItem */

/** @param {string} body @param {string[]} [prefix] @returns {RustUseItem[]} */
function rustUseItems(body, prefix = []) {
  return splitTopLevel(body).flatMap((part) => {
    const item = part.trim();
    if (!item) return [];
    const opening = item.indexOf('{');
    if (opening >= 0) {
      const parent = item.slice(0, opening).replace(/::$/, '').split('::').filter(Boolean);
      return rustUseItems(item.slice(opening + 1, item.lastIndexOf('}')), [...prefix, ...parent]);
    }
    const [source, alias] = /** @type {[string, ...string[]]} */ (item.split(/\s+as\s+/));
    const parts = [...prefix, ...source.split('::').filter(Boolean)];
    const wildcard = parts.at(-1) === '*';
    return [{ path: parts, alias: alias ?? /** @type {string} */ (parts.at(-1)), wildcard }];
  });
}

/** @param {string} rel @returns {string[]} */
function modulePath(rel) {
  const path = rel
    .replace(/^src-tauri\/src\//, '')
    .replace(/\.rs$/, '')
    .replace(/(^|\/)mod$/, '');
  return path === 'lib' || path === 'main' ? [] : path.split('/').filter(Boolean);
}

/** @param {readonly import('./shared/files.mjs').SourceFile[]} files @param {ReadonlyMap<string, string>} owners @returns {RustModuleBoundaryContext} */
export function rustModuleBoundaryContext(files, owners) {
  const modules = new Map();
  const sources = new Map();
  for (const file of files) {
    if (!file.rel.startsWith('src-tauri/src/') || /(?:^|\/)(?:tests?|[^/]*_tests?)\.rs$/.test(file.rel)) continue;
    const path = modulePath(file.rel).join('::');
    modules.set(path, file.rel);
    sources.set(file.rel, {
      ...file,
      facts: rustImportFacts(file.text),
      owner: owners.get(file.rel),
    });
  }
  return { modules, sources, owners };
}

/** @param {string} rel @param {RustScope} scope @param {string[]} parts @param {RustModuleBoundaryContext} context @param {Set<string>} [visited] @param {number} [hops] @returns {RustTarget | null} */
function resolveUseTarget(rel, scope, parts, context, visited = new Set(), hops = 0) {
  const source = context.sources.get(rel);
  if (!source) return null;
  const base = modulePath(rel);
  const nested = [];
  for (let current = scope; current?.parent; current = current.parent) if (current.module && current.name) nested.unshift(current.name);
  base.push(...nested);
  const resolved = parts[0] === 'crate' ? [] : [...base];
  for (const part of parts) {
    if (part === 'crate') resolved.length = 0;
    else if (part === 'self') continue;
    else if (part === 'super') resolved.pop();
    else resolved.push(part);
  }
  const moduleParts = parts.at(-1) === '*' ? resolved.slice(0, -1) : resolved;
  let targetFile;
  let consumed = 0;
  for (let length = moduleParts.length; length > 0; length--) {
    const found = context.modules.get(moduleParts.slice(0, length).join('::'));
    if (found) {
      targetFile = found;
      consumed = length;
      break;
    }
  }
  if (!targetFile) return null;
  const remaining = moduleParts.slice(consumed);
  if (!remaining.length) return { file: targetFile, owner: context.owners.get(targetFile), itemKind: null, module: true, hops };
  if (remaining.length !== 1) return null;
  const name = /** @type {string} */ (remaining[0]);
  const target = context.sources.get(targetFile);
  if (!target) return null;
  const declaration = target.facts.declarations.find((entry) => entry.scope === target.facts.root && entry.name === name);
  if (declaration) return { file: targetFile, owner: target.owner, itemKind: declaration.kind, module: false, hops };
  const key = targetFile + '::' + name;
  if (visited.has(key)) return null;
  visited.add(key);
  for (const entry of target.facts.uses) {
    if (!entry.exported || entry.scope !== target.facts.root) continue;
    for (const item of rustUseItems(entry.body)) {
      if (item.wildcard || item.alias !== name) continue;
      const origin = resolveUseTarget(targetFile, entry.scope, item.path, context, visited, hops + 1);
      if (origin) return origin;
    }
  }
  return null;
}

/** @param {RustScope} scope @returns {boolean} */
function isTestModule(scope) {
  for (let current = /** @type {RustScope | null} */ (scope); current; current = current.parent) if (current.name === 'tests') return true;
  return false;
}

/** @param {RustScope} scope @param {RustScope} parent @returns {boolean} */
function belongsToScope(scope, parent) {
  for (let current = /** @type {RustScope | null} */ (scope); current; current = current.parent) if (current === parent) return true;
  return false;
}

/** @param {RustModuleBoundaryContext} context */
export function rustImportDependencies(context) {
  /** @type {{file:string,target:string,offset:number,line:number,column:number,symbol:string}[]} */
  const dependencies = [];
  for (const source of context.sources.values()) {
    const at = sourcePositions(source.text);
    for (const entry of source.facts.uses) {
      if (entry.exported || !entry.scope.module || isTestModule(entry.scope)) continue;
      for (const item of rustUseItems(entry.body)) {
        const target = resolveUseTarget(source.rel, entry.scope, item.path, context);
        if (!target) continue;
        const references = target.module
          ? source.facts.paths.filter((reference) => reference.parts[0] === item.alias && belongsToScope(reference.scope, entry.scope))
          : [];
        const targets = references.length
          ? references.flatMap((reference) => {
              const parts = [...item.path, ...reference.parts.slice(1)];
              for (let length = parts.length; length > item.path.length; length--) {
                const used = resolveUseTarget(source.rel, entry.scope, parts.slice(0, length), context);
                if (used) return [{ target: used, offset: reference.start }];
              }
              return [];
            })
          : [{ target, offset: entry.start }];
        for (const resolved of targets)
          dependencies.push({
            file: source.rel,
            target: resolved.target.file,
            offset: resolved.offset,
            ...at(resolved.offset),
            symbol: item.path.join('::'),
          });
      }
    }
  }
  return dependencies;
}

/** @param {import('./shared/files.mjs').SourceFile} file @param {RustModuleBoundaryContext} context */
export function checkRustModuleBoundaries(file, context) {
  const source = context.sources.get(file.rel);
  if (!source?.owner) return [];
  const facts = source.facts;
  /** @param {number} offset */
  const at = (offset) => {
    const before = file.text.slice(0, offset);
    const line = before.split('\n').length;
    return { line, column: offset - before.lastIndexOf('\n') };
  };
  /** @type {import('./architecture/diagnostics.mjs').Diagnostic[]} */
  const diagnostics = [];
  /** @param {number} offset @param {string} ruleId @param {string} symbol @param {string} message */
  function report(offset, ruleId, symbol, message) {
    diagnostics.push({
      ruleId,
      file: file.rel,
      ...at(offset),
      symbol,
      message,
      expected: 'direct business exports and named cross-module imports',
      reference: '.zcode/backend-guidelines.md#代码组织',
      source: 'scripts/check-rust-module-boundaries.mjs',
    });
  }
  for (const entry of facts.uses) {
    if (!entry.scope.module || isTestModule(entry.scope)) continue;
    const exported = entry.exported;
    if (exported && technicalExports.has(file.rel)) continue;
    for (const item of rustUseItems(entry.body)) {
      const target = resolveUseTarget(file.rel, entry.scope, item.path, context);
      if (exported) {
        if (item.wildcard)
          report(
            entry.start,
            'rust-business-export-glob',
            item.path.join('::'),
            'business module exports must name each implementation item',
          );
        else if (!target)
          report(entry.start, 'rust-business-export-origin', item.path.join('::'), 'business exports must resolve to a declaration');
        else if (target.hops)
          report(
            entry.start,
            'rust-business-export-chain',
            item.path.join('::'),
            'business exports must point directly to their declaration',
          );
      } else if (target?.owner && target.owner !== source.owner && item.wildcard) {
        report(entry.start, 'rust-business-import-glob', item.path.join('::'), 'cross-module imports must not use a wildcard');
      } else if (target?.owner && target.owner !== source.owner && target.module) {
        for (const reference of facts.paths.filter(({ parts, scope }) => parts[0] === item.alias && belongsToScope(scope, entry.scope))) {
          const members = reference.parts.slice(1);
          for (let length = 1; length <= members.length; length++) {
            const used = resolveUseTarget(file.rel, entry.scope, [...item.path, ...members.slice(0, length)], context);
            if (used?.module || !used || !['struct', 'enum', 'trait', 'type'].includes(used.itemKind ?? '')) continue;
            report(
              reference.start,
              'rust-business-import-type',
              [...item.path, ...members.slice(0, length)].join('::'),
              'cross-module types must be imported by their declared name',
            );
            break;
          }
        }
      }
    }
  }
  return diagnostics;
}
