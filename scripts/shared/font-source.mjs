import * as css from 'css-tree';
import { posix } from 'node:path';
import { parseFrontendSource } from './frontend-source.mjs';

const fontVariables = new Set(['--font-interface', '--font-field', '--font-text-editor']);
const fontKeywords = new Set([
  'normal',
  'italic',
  'oblique',
  'small-caps',
  'bold',
  'bolder',
  'lighter',
  'ultra-condensed',
  'extra-condensed',
  'condensed',
  'semi-condensed',
  'semi-expanded',
  'expanded',
  'extra-expanded',
  'ultra-expanded',
  'xx-small',
  'x-small',
  'small',
  'medium',
  'large',
  'x-large',
  'xx-large',
  'xxx-large',
  'smaller',
  'larger',
]);
const roles = new Map([
  ['.ui-text-path', '--font-field'],
  ['.ui-code', '--font-field'],
  ['.text-editor-surface .cm-content', '--font-text-editor'],
]);
/** @typedef {{file:{rel:string,text:string}, imports:string[], text:import('css-tree').Declaration[], roots:import('css-tree').Declaration[], roles:Map<string,import('css-tree').Declaration|null>}} FontSheet */
/** Font inheritance is valid when the stylesheet entry supplies the document font. */
/** @param {{rel:string,text:string}[]} files */
export function checkFontSources(files) {
  /** @type {Map<string,FontSheet>} */
  const sheets = new Map();
  /** @type {string[]} */
  const failures = [];
  for (const file of files.filter((file) => file.rel.endsWith('.css'))) {
    const ast = css.parse(file.text, { positions: true, parseCustomProperty: true });
    /** @type {FontSheet} */
    const sheet = { file, imports: [], text: [], roots: [], roles: new Map() };
    sheets.set(file.rel, sheet);
    css.walk(ast, {
      visit: 'Atrule',
      enter(node) {
        const first = node.prelude?.children.first;
        if (node.name === 'import' && (first?.type === 'String' || first?.type === 'Url'))
          sheet.imports.push(posix.normalize(posix.join(posix.dirname(file.rel), first.value)));
      },
    });
    css.walk(ast, {
      visit: 'Rule',
      enter(node) {
        const selectors = css
          .generate(node.prelude)
          .split(',')
          .map((selector) => selector.trim());
        for (const declaration of node.block.children) {
          if (declaration.type !== 'Declaration') continue;
          const property = declaration.property,
            value = css.generate(declaration.value);
          if (fontVariables.has(property) && (declaration.important || selectors.some((selector) => selector !== ':root')))
            report(file, declaration, 'configured font variables may only declare defaults at :root');
          if (property === 'all' && !['inherit', 'unset'].includes(value))
            report(file, declaration, 'all resets must preserve the inherited font source');
          if (
            /^(?:font(?:-|$)|line-height$|letter-spacing$|word-spacing$|text-|white-space$|overflow-wrap$|word-break$|color$)/.test(
              property,
            )
          )
            sheet.text.push(declaration);
          if (property !== 'font' && property !== 'font-family') continue;
          if (selectors.some((selector) => [':root', 'html', 'body', '*'].includes(selector))) sheet.roots.push(declaration);
          for (const selector of selectors) if (roles.has(selector)) sheet.roles.set(selector, declaration);
          if (value === 'inherit' || value === 'unset') continue;
          const variable = /var\((--font-[a-z-]+)\)$/.exec(value)?.[1];
          const literalFamily =
            declaration.value.type === 'Value' &&
            declaration.value.children
              .toArray()
              .some((node) => node.type === 'String' || (node.type === 'Identifier' && !fontKeywords.has(node.name)));
          if (!variable || !fontVariables.has(variable) || literalFamily || (property === 'font-family' && value !== `var(${variable})`))
            report(file, declaration, 'font declarations must inherit or consume a configured font variable');
        }
        for (const selector of selectors) if (roles.has(selector) && !sheet.roles.has(selector)) sheet.roles.set(selector, null);
      },
    });
  }
  for (const file of files.filter((file) => !file.rel.endsWith('.css') && file.text.includes('.css'))) {
    const imports = parseFrontendSource({ ...file, path: file.rel }, { references: false })
      .imports.filter((entry) => entry.specifier.endsWith('.css'))
      .map((entry) =>
        entry.specifier.startsWith('@/')
          ? 'src/' + entry.specifier.slice(2)
          : posix.normalize(posix.join(posix.dirname(file.rel), entry.specifier)),
      );
    if (imports.some((path) => posix.basename(path) === 'style.css'))
      sheets.set(file.rel, { file, imports, text: [], roots: [], roles: new Map() });
  }
  const covered = new Set();
  for (const [path, entry] of sheets) {
    if (path.endsWith('.css') && posix.basename(path) !== 'style.css') continue;
    const reachable = new Set();
    /** @param {string} path */
    function visit(path) {
      if (reachable.has(path)) return;
      reachable.add(path);
      for (const dependency of sheets.get(path)?.imports ?? []) visit(dependency);
    }
    visit(path);
    const rooted = [...reachable].some((path) =>
      sheets.get(path)?.roots.some((declaration) => /var\(--font-(?:interface|field|text-editor)\)$/.test(css.generate(declaration.value))),
    );
    if (!rooted) report(entry.file, null, 'stylesheet entry must provide a configured document font for inherited text');
    for (const path of reachable) {
      const sheet = sheets.get(path);
      if (!sheet || covered.has(path)) continue;
      covered.add(path);
      for (const [selector, declaration] of sheet.roles) {
        if (!declaration || !css.generate(declaration.value).endsWith(`var(${roles.get(selector)})`))
          report(sheet.file, declaration, `${selector} must consume ${roles.get(selector)}`);
      }
    }
  }
  for (const [path, sheet] of sheets)
    if (!covered.has(path) && sheet.text.length)
      report(sheet.file, sheet.text[0], 'text stylesheet must belong to an entry with a configured document font');
  return failures;
  /** @param {{rel:string}} file @param {import('css-tree').Declaration|null|undefined} node @param {string} reason */
  function report(file, node, reason) {
    failures.push(`${file.rel}:${node?.loc?.start.line ?? 1}:${node?.loc?.start.column ?? 1}: css.font-source: ${reason}`);
  }
}
