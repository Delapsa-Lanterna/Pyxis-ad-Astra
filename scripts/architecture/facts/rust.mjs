import { productionRustSource } from '../../shared/rust-source.mjs';
import { sourcePositions } from '../../shared/source-position.mjs';
import { rustServicePaths } from './rust-crate-paths.mjs';

/** @typedef {{name: string, attributes: string[], start: number, end: number, body: string, signature: string, line: number, column: number}} RustFunction */
/** @typedef {{code: string, references: import('./rust-crate-paths.mjs').RustReference[], functions: RustFunction[]}} RustFacts */

/** @param {import('../../shared/files.mjs').SourceFile} file @param {string} code @param {Map<string, string[]>} exports @returns {RustFacts} */
export function rustFacts(file, code, exports) {
  const at = sourcePositions(file.text);
  const functions = [];
  const attributes = [];
  for (const match of code.matchAll(/#\[\s*([A-Za-z_][A-Za-z0-9_:]*)/g)) {
    let end = match.index + 2;
    let depth = 1;
    while (++end < code.length && depth) {
      if (code[end] === '[') depth++;
      if (code[end] === ']') depth--;
    }
    attributes.push({ path: /** @type {string} */ (match[1]), start: match.index, end });
  }
  for (const match of code.matchAll(
    /\b(?:pub(?:\([^)]*\))?\s+)?(?:(?:async|const|unsafe|extern)\s+)*fn\s+((?:r#)?[A-Za-z_][A-Za-z0-9_]*)\s*/g,
  )) {
    let opening = match.index + match[0].length;
    let angles = 0;
    let groups = 0;
    for (; opening < code.length; opening++) {
      const character = code.charAt(opening);
      if (character === '(' && !angles && !groups) break;
      if ('([{'.includes(character)) groups++;
      else if (')]}'.includes(character)) groups--;
      else if (!groups && character === '<') angles++;
      else if (!groups && character === '>' && code[opening - 1] !== '-') angles--;
    }
    opening++;
    let depth = 1;
    for (; opening < code.length && depth; opening++) {
      if (code[opening] === '(') depth++;
      if (code[opening] === ')') depth--;
    }
    for (; opening < code.length && code[opening] !== '{' && code[opening] !== ';'; opening++);
    let end = opening;
    if (code[opening] === '{') {
      depth = 1;
      while (++end < code.length && depth) {
        if (code[end] === '{') depth++;
        if (code[end] === '}') depth--;
      }
    }
    const attached = [];
    let start = match.index;
    for (let index = attributes.length - 1; index >= 0; index--) {
      const attribute = /** @type {{path: string, start: number, end: number}} */ (attributes[index]);
      if (attribute.end > start) continue;
      if (!/^(?:\s|pub(?:\([^)]*\))?|async|const|unsafe|extern)*$/.test(code.slice(attribute.end, start))) break;
      attached.unshift(attribute.path);
      start = attribute.start;
    }
    functions.push({
      name: /** @type {string} */ (match[1]),
      attributes: attached,
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
