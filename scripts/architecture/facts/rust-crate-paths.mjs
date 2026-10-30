import { splitTopLevel } from '../../shared/rust-source.mjs';

/** @typedef {{path: string[], alias: string}} UsePath */
/** @typedef {{start:number,end:number,parts:string[],parent:RustScope | null,aliases:Map<string,string[]>}} RustScope */
/** @typedef {{path: string[], target: string[], exported: boolean, offset: number, line: number, column: number}} RustReference */

/** @param {string} rel @returns {string[]} */
export function modulePartsFromRel(rel) {
  return rel
    .replace(/^src-tauri\/src\//, '')
    .replace(/\.rs$/, '')
    .replace(/(^|\/)mod$/, '')
    .split('/')
    .filter(Boolean);
}

/** @param {string[]} base @param {string[]} parts @returns {string[]} */
function resolveParts(base, parts) {
  const resolved = [...base];
  for (const part of parts) {
    if (part === 'crate') resolved.length = 0;
    else if (part === 'super') resolved.pop();
    else if (part !== 'self') resolved.push(part);
  }
  return resolved;
}

/** @param {string} source @param {string[]} [prefix] @returns {UsePath[]} */
function expandUseTree(source, prefix = []) {
  return splitTopLevel(source).flatMap((part) => {
    const item = part.trim();
    if (!item) return [];
    const opening = item.indexOf('{');
    if (opening >= 0) {
      const before = item.slice(0, opening).replace(/::$/, '');
      return expandUseTree(item.slice(opening + 1, item.lastIndexOf('}')), [...prefix, ...before.split('::').filter(Boolean)]);
    }
    const [original, alias] = /** @type {[string, ...string[]]} */ (item.split(/\s+as\s+/));
    const parts = [...prefix, ...original.split('::').filter(Boolean)];
    return [{ path: parts, alias: alias ?? /** @type {string} */ (parts.at(-1)) }];
  });
}

/** @param {string} code @returns {Map<string, string[]>} */
export function serviceExportsFromSource(code) {
  const exports = new Map();
  for (const match of code.matchAll(/\bpub(?:\([^)]*\))?\s+use\s+([^;]+);/g))
    for (const item of expandUseTree(/** @type {string} */ (match[1])))
      exports.set(item.alias, resolveParts(['services'], ['self', ...item.path]));
  return exports;
}

/** @param {string} code @param {string} rel @param {Map<string, string[]>} exports @param {(offset: number) => {line: number, column: number}} [positionAt] @returns {RustReference[]} */
export function rustServicePaths(code, rel, exports, positionAt = () => ({ line: 1, column: 1 })) {
  const base = modulePartsFromRel(rel);
  /** @type {RustScope} */
  const root = {
    start: 0,
    end: code.length,
    parts: base,
    parent: null,
    aliases: new Map([
      ['services', ['services']],
      ['serde_json', ['serde_json']],
      ['std', ['std']],
    ]),
  };
  /** @type {RustScope[]} */
  const scopes = [root];
  const modules = new Map(
    [...code.matchAll(/\bmod\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g)].map((match) => [
      match.index + match[0].length - 1,
      /** @type {string} */ (match[1]),
    ]),
  );
  const stack = [root];
  for (let offset = 0; offset < code.length; offset++) {
    if (code[offset] === '{') {
      const parent = /** @type {RustScope} */ (stack[stack.length - 1]);
      const name = modules.get(offset);
      const scope = { start: offset, end: code.length, parts: name ? [...parent.parts, name] : parent.parts, parent, aliases: new Map() };
      scopes.push(scope);
      stack.push(scope);
    } else if (code[offset] === '}') {
      /** @type {RustScope} */ (stack[stack.length - 1]).end = offset;
      stack.pop();
    }
  }
  /** @param {number} offset */
  function scopeAt(offset) {
    for (let index = scopes.length - 1; index > 0; index--) {
      const scope = /** @type {RustScope} */ (scopes[index]);
      if (scope.start <= offset && scope.end >= offset) return scope;
    }
    return root;
  }
  /** @param {string} name @param {number} offset @returns {string[] | undefined} */
  function aliasAt(name, offset) {
    /** @type {RustScope | null} */
    let scope = scopeAt(offset);
    while (scope) {
      const value = scope.aliases.get(name);
      if (value) return value;
      scope = scope.parent;
    }
    return undefined;
  }
  const uses = [...code.matchAll(/\buse\s+([^;]+);/g)];
  const ignored = [...uses, ...code.matchAll(/\bpub\s*\(\s*in\s+[^)]+\)/g)];
  /** @param {number} offset */
  const withinUse = (offset) => ignored.some((use) => use.index <= offset && offset < use.index + use[0].length);
  /** @type {Map<string, RustReference>} */
  const references = new Map();
  /** @param {string[]} parts @param {number} offset */
  function add(parts, offset) {
    const key = parts.join('::') + ':' + offset;
    if (!parts.length || references.has(key)) return;
    const definition = parts[0] === 'services' ? exports.get(/** @type {string} */ (parts[1])) : undefined;
    references.set(key, {
      path: parts,
      target: definition ? [...definition, ...parts.slice(2)] : parts,
      exported: !!definition,
      offset,
      ...positionAt(offset),
    });
  }
  for (const match of uses) {
    for (const item of expandUseTree(/** @type {string} */ (match[1]))) {
      const first = /** @type {string} */ (item.path[0]);
      const alias = aliasAt(first, match.index);
      const resolved = ['crate', 'super', 'self'].includes(first)
        ? resolveParts(scopeAt(match.index).parts, item.path)
        : first === 'services'
          ? item.path
          : base.join('::') === 'services'
            ? resolveParts(base, ['self', ...item.path])
            : alias
              ? [...alias, ...item.path.slice(1)]
              : null;
      if (!resolved) continue;
      scopeAt(match.index).aliases.set(item.alias, resolved);
      add(
        resolved.filter((part) => part !== '*'),
        match.index,
      );
    }
  }
  for (const match of code.matchAll(/\b(?:let|const|static)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([A-Za-z_][A-Za-z0-9_:]*)/g)) {
    const expression = /** @type {string} */ (match[2]);
    const parts = expression.split('::').filter(Boolean);
    const first = /** @type {string} */ (parts[0]);
    const alias = aliasAt(first, match.index);
    const resolved = ['crate', 'super', 'self'].includes(first)
      ? resolveParts(scopeAt(match.index).parts, parts)
      : first === 'services'
        ? parts
        : alias
          ? [...alias, ...parts.slice(1)]
          : null;
    if (resolved) scopeAt(match.index).aliases.set(/** @type {string} */ (match[1]), resolved);
  }
  for (const match of code.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)::([A-Za-z0-9_:]+)/g)) {
    if (withinUse(match.index)) continue;
    const parts = /** @type {string} */ (match[2]).split('::').filter(Boolean);
    if (['crate', 'super', 'self'].includes(/** @type {string} */ (match[1])))
      add(resolveParts(scopeAt(match.index).parts, [/** @type {string} */ (match[1]), ...parts]), match.index);
    else {
      const alias = aliasAt(/** @type {string} */ (match[1]), match.index);
      if (alias) add([...alias, ...parts], match.index);
    }
  }
  for (const match of code.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*\(/g)) {
    if (withinUse(match.index)) continue;
    const alias = aliasAt(/** @type {string} */ (match[1]), match.index);
    if (alias) add(alias, match.index);
  }
  return [...references.values()];
}

/** @param {string} text @param {string} [rel] @returns {string[][]} */
export function cratePaths(text, rel = '') {
  return [...new Map(rustServicePaths(text, rel, new Map()).map((reference) => [reference.path.join('::'), reference.path])).values()];
}

/** @param {readonly import('./context.mjs').ArchitectureFile[]} files @returns {Map<string, string[]>} */
export function rustServiceExports(files) {
  return serviceExportsFromSource(files.find((file) => file.rel === 'src-tauri/src/services/mod.rs')?.rust.code ?? '');
}
