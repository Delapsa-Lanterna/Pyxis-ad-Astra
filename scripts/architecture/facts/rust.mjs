import { posix } from 'node:path';
import { productionRustSource } from '../../shared/rust-source.mjs';
import { sourcePositions } from '../../shared/source-position.mjs';
import { rustServicePaths } from './rust-crate-paths.mjs';
import { splitTopLevel } from '../../shared/rust-source.mjs';

/** @typedef {{name: string, commandName: string, public: boolean, attributes: string[], attributeArguments: ReadonlyMap<string,string>, start: number, end: number, body: string, signature: string, line: number, column: number}} RustFunction */
/** @typedef {{name: string, target: string, arguments: string[], literals: Array<string | null>, offset: number, line: number, column: number}} RustCall */
/** @typedef {{macro: string, expression: string, path: string | null, offset: number, line: number, column: number}} RustEmbeddedAsset */
/** @typedef {{embeddedAssets: RustEmbeddedAsset[], code: string, references: import('./rust-crate-paths.mjs').RustReference[], functions: RustFunction[], calls: RustCall[]}} RustFacts */

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
    attributes.push({
      path: /** @type {string} */ (match[1]),
      start: match.index,
      end,
      arguments: file.text.slice(match.index + match[0].length, end),
    });
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
      const attribute = /** @type {{path: string, start: number, end: number, arguments:string}} */ (attributes[index]);
      if (attribute.end > start) continue;
      if (!/^(?:\s|pub(?:\([^)]*\))?|async|const|unsafe|extern)*$/.test(code.slice(attribute.end, start))) break;
      attached.unshift(attribute);
      start = attribute.start;
    }
    const name = /** @type {string} */ (match[1]);
    const attributeArguments = new Map(attached.map((attribute) => [attribute.path, attribute.arguments]));
    const rename = /\brename\s*=\s*"([^"]+)"/.exec(attributeArguments.get('command_macros::command') ?? '');
    functions.push({
      name,
      commandName: rename?.[1] ?? name,
      public: /^\s*pub(?:\s*\([^)]*\))?\s/.test(/** @type {string} */ (match[0])),
      attributes: attached.map((attribute) => attribute.path),
      attributeArguments,
      start: match.index,
      end,
      body: code.slice(opening, end),
      signature: code.slice(match.index, opening),
      ...at(match.index),
    });
  }
  const references = rustServicePaths(code, file.rel, exports, at);
  const targets = new Map(references.map((edge) => [edge.offset, edge.target.join('::')]));
  const calls = [];
  for (const match of code.matchAll(/\b((?:[A-Za-z_]\w*::)*([A-Za-z_]\w*))\s*\(/g)) {
    const opening = match.index + match[0].length;
    let end = opening,
      depth = 1;
    while (end < code.length && depth) {
      if (code[end] === '(') depth++;
      if (code[end] === ')') depth--;
      end++;
    }
    const args = splitTopLevel(code.slice(opening, end - 1));
    let argumentStart = opening;
    const literals = args.map((argument) => {
      const text = file.text.slice(argumentStart, argumentStart + argument.length);
      argumentStart += argument.length + 1;
      return embeddedLiteral(text);
    });
    calls.push({
      name: /** @type {string} */ (match[2]),
      target: targets.get(match.index) ?? /** @type {string} */ (match[1]),
      arguments: args,
      literals,
      offset: match.index,
      ...at(match.index),
    });
  }
  for (const call of calls) {
    if (call.name === 'canonicalize' && call.target === 'std::path::Path') call.target = 'std::path::Path::canonicalize';
    const receiver = /\b([A-Za-z_]\w*)\.\s*$/.exec(code.slice(0, call.offset));
    if (!receiver) continue;
    const owner = functions.filter((fn) => fn.start < call.offset && fn.end > call.offset).sort((a, b) => b.start - a.start)[0];
    if (!owner) continue;
    if (call.name === 'canonicalize') {
      const parameter = [...owner.signature.matchAll(/\b([A-Za-z_]\w*)\s*:\s*&(?:'\w+\s+)?(?:mut\s+)?([A-Za-z_:][\w:]*)/g)].find(
        (match) => {
          const typeStart = owner.start + (match.index ?? 0) + match[0].lastIndexOf(match[2] ?? '');
          return (
            match[1] === receiver[1] &&
            references.some((reference) => reference.offset === typeStart && reference.target.join('::') === 'std::path::Path')
          );
        },
      );
      if (parameter) call.target = 'std::path::Path::canonicalize';
    }
    const assignments = [
      ...code
        .slice(owner.start, call.offset)
        .matchAll(/\blet\s+(?:mut\s+)?([A-Za-z_]\w*)\s*(?::[^=;]+)?=\s*([A-Za-z_][A-Za-z0-9_:]*)\s*\(/g),
    ];
    const assigned = assignments.filter((match) => match[1] === receiver[1]).at(-1);
    if (!assigned) continue;
    const offset = owner.start + assigned.index + assigned[0].lastIndexOf(/** @type {string} */ (assigned[2]));
    const constructor = targets.get(offset) ?? assigned[2];
    if (/^(?:std|tokio)::fs::File::(?:open|create|create_new)$/.test(constructor ?? ''))
      call.target = constructor?.replace(/::[^:]+$/, '::' + call.name) ?? call.target;
  }

  const embeddedAssets = [];
  for (const match of code.matchAll(/\b(include_str|include_bytes|include)\s*!\s*([([{])/g)) {
    const opening = match[2] ?? '(',
      closing = { '(': ')', '[': ']', '{': '}' }[opening];
    const start = match.index + match[0].length;
    let end = start,
      depth = 1;
    while (end < code.length && depth) {
      if (code[end] === opening) depth++;
      else if (code[end] === closing) depth--;
      end++;
    }
    const expression = file.text.slice(start, end - 1),
      literal = embeddedLiteral(expression);
    embeddedAssets.push({
      macro: match[1] ?? '',
      expression,
      path: literal === null ? null : posix.normalize(posix.join(posix.dirname(file.rel), literal)),
      offset: match.index,
      ...at(match.index),
    });
  }

  return { code, references, functions, calls, embeddedAssets };
}

/** @param {string} expression @returns {string | null} */
function embeddedLiteral(expression) {
  let start = 0;
  while (start < expression.length) {
    if (/\s/.test(expression[start] ?? '')) {
      start++;
      continue;
    }
    if (expression.startsWith('//', start)) {
      const end = expression.indexOf('\n', start);
      start = end < 0 ? expression.length : end + 1;
      continue;
    }
    if (expression.startsWith('/*', start)) {
      let depth = 1;
      start += 2;
      while (start < expression.length && depth) {
        if (expression.startsWith('/*', start)) {
          depth++;
          start += 2;
        } else if (expression.startsWith('*/', start)) {
          depth--;
          start += 2;
        } else start++;
      }
      continue;
    }
    break;
  }
  const value = expression.slice(start);
  const raw = /^r(#*)"([\s\S]*?)"\1/.exec(value),
    quoted = raw ? null : /^"((?:\\[\s\S]|[^"\\])*)"/.exec(value);
  const literal = raw ?? quoted;
  if (!literal || productionRustSource(value.slice(literal[0].length)).replace(',', '').trim()) return null;
  if (raw) return raw[2] ?? null;
  const escapes = new Map([
    ['n', '\n'],
    ['r', '\r'],
    ['t', '\t'],
    ['0', '\0'],
    ['\\', '\\'],
    ['"', '"'],
    ["'", "'"],
  ]);
  return (quoted?.[1] ?? '').replace(
    /\\(?:u\{([\da-fA-F_]+)\}|x([\da-fA-F]{2})|(\r?\n\s*)|([\s\S]))/g,
    (
      /** @type {string} */ _match,
      /** @type {string|undefined} */ unicode,
      /** @type {string|undefined} */ hex,
      /** @type {string|undefined} */ continuation,
      /** @type {string} */ character,
    ) => {
      if (unicode) return String.fromCodePoint(parseInt(unicode.replaceAll('_', ''), 16));
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (continuation) return '';
      return escapes.get(character) ?? character;
    },
  );
}

export { productionRustSource };
