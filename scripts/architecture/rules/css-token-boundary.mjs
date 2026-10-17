import * as csstree from 'css-tree';
import { parse } from '@vue/compiler-sfc';
import { parse as parseHtml } from '@vue/compiler-dom';
import { basename } from 'node:path';
import { parseFrontendSource } from '../../shared/frontend-source.mjs';
import { CSS_SCOPES, selectorScope } from '../../shared/css-scopes.mjs';
import {
  CSS_TOKEN_OWNER,
  ORIGINAL_SPACING_OWNER,
  THIRD_PARTY_PROPERTIES,
  DOM_PROPERTIES,
  SPECIAL_VALUES,
} from '../../shared/css-policy.mjs';

const REQUIRED_TOKENS = [
  '--color-bg',
  '--color-overlay',
  '--color-panel',
  '--color-panel-muted',
  '--color-surface',
  '--color-surface-hover',
  '--color-surface-active',
  '--color-border',
  '--color-border-strong',
  '--color-text',
  '--color-text-soft',
  '--color-muted',
  '--color-faint',
  '--color-primary',
  '--color-primary-hover',
  '--color-primary-pressed',
  '--color-primary-soft',
  '--color-primary-border',
  '--color-on-primary',
  '--color-warning',
  '--color-warning-bg',
  '--color-warning-border',
  '--color-danger',
  '--color-success',
  '--color-success-bg',
  '--color-danger-bg',
  '--color-danger-text',
  '--color-danger-border-soft',
  '--color-danger-highlight-soft',
  '--color-danger-highlight',
  '--color-danger-highlight-border',
  '--color-canvas-bg',
  '--scrollbar-thumb',
  '--scrollbar-thumb-hover',
  '--scrollbar-track',
  '--space-1',
  '--space-2',
  '--space-3',
  '--space-4',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--shadow-floating',
  '--shadow-subtle',
];
const DARK_REQUIRED_TOKENS = REQUIRED_TOKENS.filter((token) => !token.startsWith('--space-') && !token.startsWith('--radius-'));

/** @param {{rel: string, text: string}} file @returns {string[]} */
export function checkVueStyles(file) {
  return parse(file.text, { filename: file.rel }).descriptor.styles.flatMap((style) =>
    Object.keys(style.attrs).some((attribute) => attribute.toLowerCase() === 'scoped')
      ? [`${file.rel}:${style.loc.start.line}:${style.loc.start.column}: scoped CSS is forbidden; use the shared CSS entry`]
      : [`${file.rel}:${style.loc.start.line}:${style.loc.start.column}: Vue style blocks are forbidden; use the shared CSS entry`],
  );
}

/** @param {{rel: string, text: string}} file @returns {string[]} */
export function checkStyleEntry(file) {
  const failures = file.rel.endsWith('.vue') ? checkVueStyles(file) : [];
  const facts = parseFrontendSource({ ...file, path: file.rel });
  for (const entry of facts.imports) {
    if (/\.css(?:[?#]|$)/i.test(entry.specifier) && basename(entry.specifier) !== 'style.css')
      failures.push(`${file.rel}:${entry.line}:${entry.column}: CSS imports must target style.css: ${entry.specifier}`);
  }
  if (file.rel.endsWith('.css') && basename(file.rel) !== 'style.css') {
    const ast = csstree.parse(file.text, { positions: true });
    csstree.walk(ast, {
      visit: 'Atrule',
      enter(node) {
        if (node.name.toLowerCase() === 'import')
          failures.push(
            `${file.rel}:${node.loc?.start.line ?? 1}:${node.loc?.start.column ?? 1}: only style.css may aggregate CSS imports`,
          );
      },
    });
  }
  if (file.rel.endsWith('.html')) {
    /** @param {import('@vue/compiler-dom').RootNode | import('@vue/compiler-dom').TemplateChildNode} node */
    const visit = (node) => {
      if (node.type === 1 && node.tag === 'link') {
        const attributes = node.props.filter((prop) => prop.type === 6);
        const href = attributes.find((prop) => prop.name === 'href')?.value?.content;
        const rel = attributes.find((prop) => prop.name === 'rel')?.value?.content;
        if (rel?.split(/\s+/).includes('stylesheet') && href && basename(href) !== 'style.css')
          failures.push(`${file.rel}:${node.loc.start.line}:${node.loc.start.column}: stylesheet links must target style.css: ${href}`);
      }
      if (node.type === 1 && node.tag === 'style')
        failures.push(`${file.rel}:${node.loc.start.line}:${node.loc.start.column}: inline style blocks must use style.css`);
      if (node.type === 1 && node.tag === 'script') {
        const source = file.text.slice(node.loc.start.offset, node.loc.end.offset).replace(/^<script[^>]*>|<\/script>$/g, '');
        failures.push(...checkStyleEntry({ rel: file.rel + '.js', text: source }));
      }
      if (node.type === 0 || node.type === 1) for (const child of node.children) visit(child);
    };
    visit(parseHtml(file.text));
  }
  return failures;
}

/** @param {string} selector @returns {string} */
export function cssScope(selector) {
  const scopes = new Set(cssScopes(selector));
  return scopes.size === 1 ? [...scopes][0] : 'base';
}

/** @param {import('css-tree').Selector} selector @returns {string[][]} */
function selectorBranches(selector) {
  /** @type {string[][]} */
  let branches = [[]];
  for (const node of selector.children) {
    if (node.type === 'ClassSelector') branches = branches.map((names) => [...names, node.name]);
    if (node.type !== 'PseudoClassSelector' || !['is', 'where'].includes(node.name)) continue;
    const alternatives = node.children.toArray().flatMap((list) => list.children.toArray().flatMap(selectorBranches));
    branches = branches.flatMap((names) => alternatives.map((alternative) => [...names, ...alternative]));
  }
  return branches;
}

/** @param {string} selector @returns {string[]} */
export function cssScopes(selector) {
  const ast = csstree.parse(selector, { context: 'selector' });
  const scopes = selectorBranches(ast).map(selectorScope);
  if (scopes.some((scope) => scope !== 'base')) return scopes;
  /** @type {string[]} */
  const conditions = [];
  csstree.walk(ast, {
    visit: 'PseudoClassSelector',
    enter(node) {
      if (node.name === 'has')
        for (const list of node.children) conditions.push(...list.children.toArray().flatMap(selectorBranches).map(selectorScope));
    },
  });
  return conditions.length ? conditions : scopes;
}

/** @param {{rel: string, text: string}} file @returns {string[]} */
export function checkCssScope(file) {
  /** @type {string[]} */
  const failures = [];
  const owner = basename(file.rel, '.css');
  if (!['base', 'style'].includes(owner) && !CSS_SCOPES.has(owner))
    failures.push(`${file.rel}: CSS files must use a registered semantic scope name`);
  const ast = csstree.parse(file.text, { positions: true });
  csstree.walk(ast, {
    visit: 'ClassSelector',
    enter(node) {
      if (/^(?:lab(?:-|$)|aligned-)/.test(node.name))
        failures.push(
          `${file.rel}:${node.loc?.start.line ?? 1}: CSS classes must describe component responsibilities, not preview variants`,
        );
    },
  });
  csstree.walk(ast, {
    visit: 'Atrule',
    enter(node) {
      if (owner === 'style' && node.name.toLowerCase() !== 'import')
        failures.push(`${file.rel}:${node.loc?.start.line ?? 1}: style.css must contain only CSS imports`);
    },
  });
  csstree.walk(ast, {
    visit: 'Rule',
    enter(rule) {
      if (rule.prelude.type !== 'SelectorList') return;
      const scopes = new Set(rule.prelude.children.toArray().flatMap((selector) => cssScopes(csstree.generate(selector))));
      const expected = scopes.size === 1 ? [...scopes][0] : 'base';
      if (owner !== expected)
        failures.push(`${file.rel}:${rule.loc?.start.line ?? 1}: selector scope belongs in ${expected}.css, not ${owner}.css`);
    },
  });
  return failures;
}

export const cssTokenBoundaryRule = {
  name: 'css-token-boundary',
  /** @param {Array<{rel: string, text: string}>} files @returns {string[]} */
  check(files) {
    const failures = [];
    const global = new Set();
    const base = new Set();
    const dark = new Set();
    /** @type {Map<string, string[]>} */
    const local = new Map();
    /** @type {Map<string, import('css-tree').Selector>} */
    const selectorNodes = new Map();
    /** @type {Array<{ file: { rel: string }, node: import('css-tree').Declaration, value: string, selectors: string[] }>} */
    const declarations = [];
    for (const file of files.filter((file) => file.rel.startsWith('src/styles/') && file.rel.endsWith('.css'))) {
      let ast;
      try {
        ast = csstree.parse(file.text, { positions: true, parseCustomProperty: true });
      } catch (error) {
        failures.push(`${file.rel}: CSS parse failed: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      csstree.walk(ast, {
        visit: 'Rule',
        enter(rule) {
          if (rule.prelude.type !== 'SelectorList') return;
          const selectors = rule.prelude.children.toArray().map((selector) => {
            const text = csstree.generate(selector);
            selectorNodes.set(text, selector);
            return text;
          });
          for (const node of rule.block.children) {
            if (node.type !== 'Declaration') continue;
            const value = csstree.generate(node.value);
            declarations.push({ file, node, value, selectors });
            if (!node.property.startsWith('--')) continue;
            if (node.property.startsWith('--n-')) {
              if (!thirdPartyAllowed(file, selectors, node.property))
                failures.push(diagnostic(file, node, selectors, `unauthorized third-party CSS property ${node.property}`));
              continue;
            }
            const roots = selectors.filter(
              (selector) => selector === ':root' || selector === ':root[data-theme="light"]' || selector === ':root[data-theme="dark"]',
            );
            if (roots.length) {
              global.add(node.property);
              if (roots.some((selector) => selector !== ':root[data-theme="dark"]')) base.add(node.property);
              if (roots.includes(':root[data-theme="dark"]')) dark.add(node.property);
            } else {
              const scopes = local.get(node.property) ?? [];
              scopes.push(...selectors);
              local.set(node.property, scopes);
            }
          }
        },
      });
    }
    for (const token of new Set([...REQUIRED_TOKENS, ...global]))
      if (!base.has(token)) failures.push(`src/styles/base.css: missing base token ${token}`);
    for (const token of new Set([
      ...DARK_REQUIRED_TOKENS,
      ...[...global].filter((token) => token.startsWith('--color-') || token.startsWith('--shadow-')),
    ]))
      if (!dark.has(token)) failures.push(`src/styles/base.css: missing dark theme token ${token}`);

    for (const { file, node, value, selectors } of declarations) {
      if (node.property === 'clip-path' && value.startsWith('polygon(') && value.split(',').length === 6)
        failures.push(diagnostic(file, node, selectors, 'cut buttons must use four cut corners'));
      if (node.property.startsWith('--') && global.has(node.property) && file.rel !== CSS_TOKEN_OWNER)
        failures.push(diagnostic(file, node, selectors, 'shared CSS tokens must be defined in base.css'));
      /** @type {string[]} */
      const vars = [];
      csstree.walk(node.value, {
        visit: 'Function',
        enter(fn) {
          if (fn.name === 'var' && fn.children.first?.type === 'Identifier') vars.push(fn.children.first.name);
        },
      });
      for (const property of vars) {
        if (property.startsWith('--n-')) {
          if (!thirdPartyAllowed(file, selectors, property))
            failures.push(diagnostic(file, node, selectors, `unauthorized third-party CSS variable ${property}`));
        } else if (!global.has(property)) {
          const scopes = local.get(property) ?? [];
          const injected = selectors.every((selector) => DOM_PROPERTIES.get(property)?.includes(selector));
          if (
            !injected &&
            !selectors.every((selector) =>
              scopes.some((scope) =>
                withinScope(
                  /** @type {import('css-tree').Selector} */ (selectorNodes.get(selector)),
                  /** @type {import('css-tree').Selector} */ (selectorNodes.get(scope)),
                ),
              ),
            )
          ) {
            const message = scopes.length ? `CSS variable outside its scope ${property}` : `undefined CSS variable ${property}`;
            failures.push(diagnostic(file, node, selectors, message));
          }
        }
      }
      const special = selectors.every((current) =>
        SPECIAL_VALUES.some(([selector, property, expected]) => current === selector && node.property === property && value === expected),
      );
      if (special) continue;
      if (node.property === 'box-shadow' && value !== 'none' && !onlyTokenValue(node.value, '--shadow-', ['none']))
        failures.push(diagnostic(file, node, selectors, 'box-shadow must use a shared shadow token'));
      if (node.property === 'border-radius' && value !== '0' && !onlyTokenValue(node.value, '--radius-', ['0']))
        failures.push(diagnostic(file, node, selectors, 'border-radius must use a shared radius token'));
      if (isSpacingProperty(node.property)) {
        let hardcoded = false;
        let originalSpacing = false;
        csstree.walk(node.value, {
          visit: 'Dimension',
          enter(dimension) {
            if (dimension.unit === 'px' && [4, 8, 12, 16].includes(Number(dimension.value))) hardcoded = true;
            if (
              [ORIGINAL_SPACING_OWNER, 'src/styles/variant.css'].includes(file.rel) &&
              dimension.unit === 'px' &&
              [3, 9, 10, 17, 18, 21].includes(Number(dimension.value))
            )
              originalSpacing = true;
          },
        });
        if (hardcoded) failures.push(diagnostic(file, node, selectors, 'shared spacing must use a --space token'));
        if (originalSpacing)
          failures.push(
            diagnostic(file, node, selectors, 'original immersive spacing requires exact selector/property/value authorization'),
          );
      }
    }
    return failures;
  },
};

/** @param {import('css-tree').Selector} selector @param {import('css-tree').Selector} scope */
function withinScope(selector, scope) {
  const nodes = selector.children.toArray();
  const owner = scope.children.toArray();
  if (owner.length > nodes.length || owner.some((node, index) => csstree.generate(node) !== csstree.generate(nodes[index]))) return false;
  const relation = nodes.slice(owner.length).find((node) => node.type === 'Combinator');
  return relation === undefined || [' ', '>'].includes(csstree.generate(relation));
}

/** @param {{rel: string}} file @param {string[]} selectors @param {string} property */
function thirdPartyAllowed(file, selectors, property) {
  return file.rel === CSS_TOKEN_OWNER && selectors.every((selector) => THIRD_PARTY_PROPERTIES.get(selector)?.includes(property));
}

/** @param {import('css-tree').CssNode} value @param {string} prefix @param {string[]} literals */
function onlyTokenValue(value, prefix, literals) {
  if (value.type !== 'Value') return false;
  const nodes = value.children.toArray();
  return (
    nodes.length > 0 &&
    nodes.every(
      (node) =>
        literals.includes(csstree.generate(node)) ||
        (node.type === 'Function' &&
          node.name === 'var' &&
          node.children.first?.type === 'Identifier' &&
          node.children.first.name.startsWith(prefix)) ||
        (node.type === 'Function' &&
          node.name === 'calc' &&
          node.children
            .toArray()
            .some(
              (child) =>
                child.type === 'Function' &&
                child.name === 'var' &&
                child.children.first?.type === 'Identifier' &&
                child.children.first.name.startsWith(prefix),
            )),
    )
  );
}

/** @param {{rel: string}} file @param {import('css-tree').CssNode} node @param {string[]} selectors @param {string} message */
function diagnostic(file, node, selectors, message) {
  return `${file.rel}:${node.loc?.start.line ?? 1}:${node.loc?.start.column ?? 1}: ${message} [${selectors.join(', ')}; ${node.type === 'Declaration' ? node.property : ''}]`;
}

/** @param {string} property */
function isSpacingProperty(property) {
  return (
    ['gap', 'row-gap', 'column-gap', 'padding', 'margin'].includes(property) ||
    property.startsWith('padding-') ||
    property.startsWith('margin-')
  );
}
