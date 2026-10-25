import { productionRustSource } from '../../shared/rust-source.mjs';
import { sourcePositions } from '../../shared/source-position.mjs';
import { rustServicePaths } from './rust-crate-paths.mjs';

/** @typedef {{name: string, start: number, end: number, body: string, signature: string, line: number, column: number}} RustFunction */
/** @typedef {{code: string, references: import('./rust-crate-paths.mjs').RustReference[], functions: RustFunction[]}} RustFacts */

/** @param {import('../../shared/files.mjs').SourceFile} file @param {string} code @param {Map<string, string[]>} exports @returns {RustFacts} */
export function rustFacts(file, code, exports) {
  const at = sourcePositions(file.text);
  const functions = [];
  for (const match of code.matchAll(/\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z0-9_]+)\s*(?:<[^;{]*?>)?\s*\(/g)) {
    let opening = match.index + match[0].length;
    let depth = 1;
    for (; opening < code.length && depth; opening++) {
      if (code[opening] === '(') depth++;
      if (code[opening] === ')') depth--;
    }
    for (; opening < code.length && code[opening] !== '{' && code[opening] !== ';'; opening++);
    if (code[opening] !== '{') continue;
    let end = opening;
    depth = 1;
    while (++end < code.length && depth) {
      if (code[end] === '{') depth++;
      if (code[end] === '}') depth--;
    }
    functions.push({
      name: match[1],
      start: match.index,
      end,
      body: code.slice(opening, end),
      signature: code.slice(match.index, opening),
      ...at(match.index),
    });
  }
  return { code, references: rustServicePaths(code, file.rel, exports, at), functions };
}

export { productionRustSource };
