import { productionRustSource, splitTopLevel } from './rust-source.mjs';
import { singleFileByRel } from './files.mjs';

/** @param {import('./files.mjs').RepoFile[]} files @returns {Map<string, string[]>} */
export function rustServiceExports(files) {
  const file = singleFileByRel(files, 'src-tauri/src/services/mod.rs');
  const exports = new Map();
  for (const match of productionRustSource(file?.text ?? '').matchAll(/\bpub(?:\([^)]*\))?\s+use\s+([^;]+);/g))
    for (const parts of expandUseTree(match[1])) {
      const target = resolveParts(['services'], ['self', ...parts]);
      exports.set(target.at(-1), target);
    }
  return exports;
}

/** @param {string} text @param {string} moduleRelPath @param {Map<string, string[]>} exports @returns {{path: string[], target: string[], exported: boolean}[]} */
export function rustServicePaths(text, moduleRelPath, exports) {
  let qualified = text;
  for (const match of text.matchAll(/\bservices\s+as\s+([A-Za-z0-9_]+)/g))
    qualified = qualified.replace(new RegExp('\\b' + match[1] + '::', 'g'), 'crate::services::');
  qualified = qualified
    .replace(/(?<!::)\bservices::/g, 'crate::services::')
    .replace(/(\bpub(?:\([^)]*\))?\s+use\s+)(project::)/g, '$1self::$2');
  return cratePaths(qualified, moduleRelPath).map((path) => {
    const target = path[0] === 'services' ? exports.get(path[1]) : undefined;
    return { path, target: target ? [...target, ...path.slice(2)] : path, exported: !!target };
  });
}

/** @param {string} text @param {string} [moduleRelPath] @returns {string[][]} */
export function cratePaths(text, moduleRelPath = '') {
  const moduleParts = modulePartsFromRel(moduleRelPath);
  const code = text.replace(/pub\(in\s+crate::[A-Za-z0-9_:]+\)/g, 'pub');
  const paths = [];
  for (const match of code.matchAll(/\buse\s+(crate|super|self)::([^;]+);/g)) {
    paths.push(...expandUseTree(match[2]).map((item) => resolveParts(moduleParts, [match[1], ...item])));
  }
  for (const match of code.matchAll(/\b(crate|super|self)::([A-Za-z0-9_:]+)/g)) {
    paths.push(resolveParts(moduleParts, [match[1], ...match[2].split('::').filter(Boolean)]));
  }
  return [...new Map(paths.filter((path) => path.length > 0).map((path) => [path.join('::'), path])).values()];
}

/** @param {string} rel @returns {string[]} */
export function modulePartsFromRel(rel) {
  return rel
    .replace(/^src-tauri\/src\//, '')
    .replace(/\.rs$/, '')
    .replace(/(^|\/)mod$/, '')
    .split('/')
    .filter(Boolean);
}

/** @param {string[]} moduleParts @param {string[]} parts @returns {string[]} */
function resolveParts(moduleParts, parts) {
  const resolved = [...moduleParts];
  for (const part of parts) {
    if (part === 'crate') {
      resolved.length = 0;
    } else if (part === 'super') {
      resolved.pop();
    } else if (part === 'self') {
      continue;
    } else {
      resolved.push(part);
    }
  }
  return resolved;
}

/** @param {string} source @returns {string[][]} */
function expandUseTree(source) {
  return splitTopLevel(source).flatMap((item) => expandUseItem(item.trim(), []));
}

/** @param {string} item @param {string[]} prefix @returns {string[][]} */
function expandUseItem(item, prefix) {
  if (!item) return [];
  const brace = item.indexOf('{');
  if (brace < 0) return [pathParts([...prefix, item])];
  const before = item.slice(0, brace).replace(/::$/, '');
  const inner = item.slice(brace + 1, matchingBraceIndex(item, brace));
  const nextPrefix = before ? [...prefix, ...pathParts([before])] : prefix;
  return splitTopLevel(inner).flatMap((child) => expandUseItem(child.trim(), nextPrefix));
}

/** @param {string} value @param {number} openIndex @returns {number} */
function matchingBraceIndex(value, openIndex) {
  let depth = 0;
  for (let index = openIndex; index < value.length; index += 1) {
    if (value[index] === '{') depth += 1;
    if (value[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return value.length;
}

/** @param {string[]} parts @returns {string[]} */
function pathParts(parts) {
  return parts
    .join('::')
    .split('::')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== '*')
    .map((part) => part.replace(/\s+as\s+[A-Za-z0-9_]+$/, ''));
}
