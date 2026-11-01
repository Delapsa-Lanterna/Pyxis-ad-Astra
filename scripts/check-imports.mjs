import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { collectRepoPaths } from './shared/files.mjs';
import { parseFrontendSource } from './shared/frontend-source.mjs';
import { stripRustCommentsAndStrings } from './shared/rust-source.mjs';
import { sourcePositions } from './shared/source-position.mjs';
import { formatDiagnostic, sortedDiagnostics } from './architecture/diagnostics.mjs';

/** @param {import('./shared/files.mjs').SourceFile} file */
export function checkInlineTypeImports(file) {
  /** @type {import('./architecture/diagnostics.mjs').Diagnostic[]} */
  const diagnostics = [];
  const at = sourcePositions(file.text);
  parseFrontendSource(file, {
    references: false,
    onNode(node, ast, offset) {
      if (!ts.isImportTypeNode(node)) return;
      diagnostics.push({
        ruleId: 'inline-type-import',
        file: file.rel,
        ...at(offset + node.getStart(ast)),
        message: 'type dependencies must use top-level imports',
        symbol: node.getText(ast),
        expected: 'top-level import type',
        reference: '.zcode/frontend-guidelines.md#类型与分支设计',
        source: 'scripts/check-imports.mjs',
      });
    },
  });
  return diagnostics;
}

/** @typedef {{start: number, end: number, module: boolean, firstItem: number, parent: RustImportScope | null}} RustImportScope */
/** @param {string} text */
export function rustImportFacts(text) {
  const code = stripRustCommentsAndStrings(text);
  const tokens = [...code.matchAll(/(?:r#)?[A-Za-z_]\w*|::|[^\s]/g)];
  /** @type {Map<number, number>} */
  const closing = new Map();
  /** @type {number[]} */
  const delimiters = [];
  for (const [index, token] of tokens.entries()) {
    if ('([{'.includes(token[0])) delimiters.push(index);
    else if (')]}'.includes(token[0])) closing.set(/** @type {number} */ (delimiters.pop()), index);
  }
  /** @type {RustImportScope} */
  const root = { start: 0, end: text.length, module: true, firstItem: text.length, parent: null };
  const scopes = [root];
  /** @type {{start: number, end: number, scope: RustImportScope, body: string, exported: boolean}[]} */
  const uses = [];
  /** @type {{start: number, end: number, scope: RustImportScope, parts: string[]}[]} */
  const paths = [];
  let scope = root;
  let statement = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = /** @type {RegExpMatchArray} */ (tokens[index]);
    const start = /** @type {number} */ (token.index);
    if (token[0] === '#' && ['[', '!'].includes(tokens[index + 1]?.[0] ?? '')) {
      const opening = index + (tokens[index + 1]?.[0] === '!' ? 2 : 1);
      index = /** @type {number} */ (closing.get(opening));
      continue;
    }
    // Macro definitions and quoted output resolve names in the expansion's scope.
    if (token[0] === 'macro_rules' || (['quote', 'parse_quote'].includes(token[0]) && tokens[index + 1]?.[0] === '!')) {
      while (!'([{'.includes(tokens[index]?.[0] ?? '')) index++;
      index = /** @type {number} */ (closing.get(index));
      statement = index + 1;
      continue;
    }
    if (token[0] === 'use') {
      let end = index;
      while (tokens[end]?.[0] !== ';') end++;
      const last = /** @type {RegExpMatchArray} */ (tokens[end]);
      const exported = /\bpub(?:\([^)]*\))?\s*$/.test(code.slice(statement < tokens.length ? tokens[statement]?.index : 0, start));
      uses.push({ start, end: /** @type {number} */ (last.index) + 1, scope, body: code.slice(start + 3, last.index).trim(), exported });
      index = end;
      statement = end + 1;
      continue;
    }
    if (token[0] === 'pub' && tokens[index + 1]?.[0] === '(') {
      index = /** @type {number} */ (closing.get(index + 1));
      continue;
    }
    if (scope.module && ['fn', 'struct', 'enum', 'trait', 'impl', 'type', 'const', 'static', 'extern'].includes(token[0])) {
      scope.firstItem = Math.min(scope.firstItem, start);
    }
    if (token[0] === '{') {
      const header = tokens
        .slice(statement, index)
        .map((part) => part[0])
        .join(' ');
      const end = /** @type {RegExpMatchArray} */ (tokens[/** @type {number} */ (closing.get(index))]);
      scope = {
        start: start + 1,
        end: /** @type {number} */ (end.index),
        module: /\bmod\s+(?:r#)?\w+$/.test(header),
        firstItem: text.length,
        parent: scope,
      };
      scopes.push(scope);
      statement = index + 1;
      continue;
    }
    if (token[0] === '}') {
      scope = /** @type {RustImportScope} */ (scope.parent);
      statement = index + 1;
      continue;
    }
    if (token[0] === ';') statement = index + 1;
    if (!/^(?:r#)?[A-Za-z_]\w*$/.test(token[0]) || tokens[index + 1]?.[0] !== '::' || tokens[index + 2]?.[0] === '<') continue;
    const parts = [token[0]];
    let end = index;
    while (tokens[end + 1]?.[0] === '::' && /^(?:r#)?[A-Za-z_]\w*$/.test(tokens[end + 2]?.[0] ?? '')) {
      parts.push(/** @type {RegExpMatchArray} */ (tokens[end + 2])[0]);
      end += 2;
    }
    const last = /** @type {RegExpMatchArray} */ (tokens[end]);
    if (['quote', 'parse_quote'].includes(last[0]) && tokens[end + 1]?.[0] === '!') {
      index = /** @type {number} */ (closing.get(end + 2));
      continue;
    }
    paths.push({ start, end: /** @type {number} */ (last.index) + last[0].length, scope, parts });
    index = end;
  }
  return { code, scopes, uses, paths };
}

/** @param {string[]} parts */
export function rustPathImportLength(parts) {
  if (/^(?:[ui](?:8|16|32|64|128|size)|f(?:32|64)|bool|char|str)$/.test(parts[0] ?? '')) return 0;
  if (parts[0] === 'Self' || /^[A-Z]/.test(parts[0] ?? '')) return 0;
  const type = parts.findIndex((part) => /^[A-Z]/.test(part));
  if (type >= 0) return type + 1;
  if (['crate', 'super', 'self'].includes(parts[0] ?? '') || parts.length > 2) return parts.length - 1;
  return 0;
}

/** @param {import('./shared/files.mjs').SourceFile} file */
export function checkRustImports(file) {
  const facts = rustImportFacts(file.text);
  const at = sourcePositions(file.text);
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
      expected: 'imports at module top; imported types or one module qualifier at use sites',
      reference: '.zcode/backend-guidelines.md#代码组织',
      source: 'scripts/check-imports.mjs',
    });
  }
  for (const entry of facts.uses) {
    if (!entry.scope.module) report(entry.start, 'rust-local-import', entry.body, 'dependencies must be imported at module top');
    else if (!entry.exported && entry.start > entry.scope.firstItem)
      report(entry.start, 'rust-late-import', entry.body, 'imports must precede module definitions');
  }
  for (const entry of facts.paths) {
    if (rustPathImportLength(entry.parts))
      report(entry.start, 'rust-inline-path', entry.parts.join('::'), 'module paths must use top-level imports');
  }
  return diagnostics;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.vue', '.rs']);
  const files = await collectRepoPaths(process.cwd(), (rel, extension) => extensions.has(extension) && !rel.startsWith('.zcode/plans/'));
  const diagnostics = sortedDiagnostics(
    (
      await Promise.all(
        files.map(async (file) => {
          const source = { ...file, text: await readFile(file.path, 'utf8') };
          return file.rel.endsWith('.rs') ? checkRustImports(source) : checkInlineTypeImports(source);
        }),
      )
    ).flat(),
  );
  if (diagnostics.length) {
    console.error(diagnostics.map(formatDiagnostic).join('\n'));
    process.exitCode = 1;
  } else console.log('Import check passed.');
}
