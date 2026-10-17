import * as css from 'css-tree';
import ts from 'typescript';
import { parse } from '@vue/compiler-sfc';
import { baseParse } from '@vue/compiler-dom';
import { posix } from 'node:path';
import { parseFrontendSource } from './frontend-source.mjs';

/** @typedef {{rel: string, text: string}} StyleFile */
/** @typedef {{loc?: {start: {line: number, column: number}} | null} | null} SourceNode */
/** @typedef {{file: StyleFile, imports: Array<{path: string, node: import('css-tree').Atrule}>, definitions: Set<string>, uses: Array<{name: string, fallback: boolean, node: import('css-tree').Declaration}>}} Sheet */
/** @param {Array<{rel: string, text: string}>} files @param {{isolatedEntries?: string[]}} options */
export function checkStyles(files, { isolatedEntries = [] } = {}) {
  /** @type {string[]} */
  const failures = [];
  /** @type {Map<string, Sheet>} */
  const sheets = new Map();
  /** @type {Set<string>} */
  const runtime = new Set();
  const available = new Set(files.filter((file) => file.rel.endsWith('.css')).map((file) => file.rel));
  /** @param {StyleFile} file @param {SourceNode} node @param {string} code @param {string} message */
  function report(file, node, code, message) {
    const start = node?.loc?.start ?? { line: 1, column: 1 };
    failures.push(`${file.rel}:${start.line}:${start.column}: ${code}: ${message}`);
  }
  /** @param {string} text */
  function collectValues(text) {
    const source = ts.createSourceFile('style.ts', text, ts.ScriptTarget.Latest, true);
    /** @param {import('typescript').Node} node */
    function visit(node) {
      if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name) && node.name.text.startsWith('--'))
        runtime.add(node.name.text);
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'setProperty') {
        const key = node.arguments[0];
        if (key && ts.isStringLiteralLike(key) && key.text.startsWith('--')) runtime.add(key.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  /** @param {StyleFile} file @param {import('@vue/compiler-dom').RootNode | import('@vue/compiler-dom').TemplateChildNode} node */
  function inspectTemplate(file, node) {
    if (node.type === 1) {
      if (node.tag === 'style') report(file, node, 'css.entry', 'style blocks belong in the stylesheet entry');
      for (const property of node.props) {
        if (
          property.type === 7 &&
          property.name === 'bind' &&
          property.arg?.type === 4 &&
          property.arg.content === 'style' &&
          property.exp?.type === 4
        )
          collectValues(`(${property.exp.content})`);
      }
      if (node.tag === 'link') {
        const attributes = new Map(
          node.props.filter((property) => property.type === 6).map((property) => [property.name, property.value?.content]),
        );
        const href = attributes.get('href');
        if (attributes.get('rel')?.split(/\s+/).includes('stylesheet') && href) checkEntry(file, href, node);
      }
      if (node.tag === 'script')
        checkCode({
          rel: file.rel + '.js',
          text: node.children
            .filter((child) => child.type === 2)
            .map((child) => child.content)
            .join(''),
        });
    }
    if (node.type === 0 || node.type === 1) for (const child of node.children) inspectTemplate(file, child);
  }
  /** @param {StyleFile} file @param {string} specifier @param {SourceNode} node */
  function checkEntry(file, specifier, node) {
    if (posix.basename(specifier) !== 'style.css') {
      report(file, node, 'css.entry', `stylesheet imports must use style.css: ${specifier}`);
      return;
    }
    const target = specifier.startsWith('@/')
      ? 'src/' + specifier.slice(2)
      : posix.normalize(posix.join(posix.dirname(file.rel), specifier));
    if (!available.has(target)) report(file, node, 'css.import', target);
  }
  /** @param {StyleFile} file */
  function checkCode(file) {
    collectValues(file.text);
    for (const entry of parseFrontendSource({ ...file, path: file.rel }).imports) {
      if (/\.css(?:[?#]|$)/i.test(entry.specifier)) checkEntry(file, entry.specifier, { loc: { start: entry } });
    }
  }
  for (const file of files) {
    if (!file.rel.endsWith('.css')) {
      checkCode(file);
      if (file.rel.endsWith('.vue')) {
        const descriptor = parse(file.text, { filename: file.rel }).descriptor;
        for (const style of descriptor.styles) report(file, style, 'css.entry', 'component styles belong in the stylesheet entry');
        if (descriptor.template) inspectTemplate(file, baseParse(descriptor.template.content));
      } else if (file.rel.endsWith('.html')) inspectTemplate(file, baseParse(file.text));
      continue;
    }
    /** @type {Sheet} */
    const sheet = { file, imports: [], definitions: new Set(), uses: [] };
    sheets.set(file.rel, sheet);
    let ast;
    try {
      ast = css.parse(file.text, {
        positions: true,
        parseCustomProperty: true,
        onParseError: (error) => report(file, { loc: { start: error } }, 'css.syntax', error.message),
      });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      report(file, null, 'css.syntax', error.message);
      continue;
    }
    css.walk(ast, {
      visit: 'Atrule',
      enter(node) {
        if (node.name !== 'import') return;
        if (posix.basename(file.rel) !== 'style.css') report(file, node, 'css.entry', 'stylesheet aggregation belongs in style.css');
        const first = node.prelude?.children.first;
        if (first?.type === 'String' || first?.type === 'Url')
          sheet.imports.push({ path: posix.normalize(posix.join(posix.dirname(file.rel), first.value)), node });
      },
    });
    css.walk(ast, {
      visit: 'Block',
      enter(block) {
        const declarations = new Set();
        for (const node of block.children) {
          if (node.type !== 'Declaration') continue;
          const value = css.generate(node.value),
            key = node.property + ':' + value;
          if (declarations.has(key)) report(file, node, 'css.duplicate', `duplicate declaration: ${key}`);
          declarations.add(key);
          if (node.property.startsWith('--')) sheet.definitions.add(node.property);
          else {
            const match = css.lexer.matchProperty(node.property, node.value);
            if (match.error && !match.error.message.startsWith('Matching for a tree with var()'))
              report(file, node, 'css.value', `${node.property}: ${value}`);
          }
          css.walk(node.value, {
            visit: 'Function',
            enter(fn) {
              if (fn.name === 'var' && fn.children.first?.type === 'Identifier')
                sheet.uses.push({
                  name: fn.children.first.name,
                  fallback: fn.children.toArray().some((child) => child.type === 'Operator' && child.value === ','),
                  node,
                });
            },
          });
        }
      },
    });
  }
  const reported = new Set();
  /** @param {string} entry */
  function graph(entry) {
    const visited = new Set(),
      active = new Set();
    /** @param {string} path */
    function visit(path) {
      if (visited.has(path)) return;
      visited.add(path);
      active.add(path);
      const sheet = sheets.get(path);
      if (!sheet) return;
      for (const edge of sheet.imports) {
        const code = !sheets.has(edge.path) ? 'css.import' : active.has(edge.path) ? 'css.cycle' : '';
        const key = path + '>' + edge.path;
        if (code && !reported.has(key)) {
          reported.add(key);
          report(sheet.file, edge.node, code, edge.path);
        }
        if (!code) visit(edge.path);
      }
      active.delete(path);
    }
    visit(entry);
    return visited;
  }
  const entries = [...sheets.keys()].filter((path) => posix.basename(path) === 'style.css');
  for (const entry of entries) {
    const reachable = graph(entry),
      definitions = new Set(runtime);
    for (const path of reachable) for (const name of sheets.get(path)?.definitions ?? []) definitions.add(name);
    for (const path of reachable) {
      const sheet = sheets.get(path);
      if (!sheet) continue;
      if (isolatedEntries.includes(entry) && !path.startsWith(posix.dirname(entry) + '/'))
        report(sheet.file, null, 'css.isolation', `stylesheet leaves its presentation: ${entry}`);
      for (const use of sheet.uses) {
        const key = path + ':' + use.node.loc?.start.offset + ':' + use.name;
        if (!definitions.has(use.name) && !use.name.startsWith('--n-') && !use.fallback && !reported.has(key)) {
          reported.add(key);
          report(sheet.file, use.node, 'css.variable', `no CSS or literal runtime definition for ${use.name}`);
        }
      }
    }
  }
  return failures;
}
