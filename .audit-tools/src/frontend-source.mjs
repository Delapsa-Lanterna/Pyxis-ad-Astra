import ts from 'typescript';
import { parse } from '@vue/compiler-sfc';
import { baseParse, NodeTypes } from '@vue/compiler-dom';

/** @typedef {{path:string,start:number,length:number,line:number,column:number,group:string,name:string,zone:string}} SourceSite */
/** @param {ts.Node} node */
function role(node) {
  for (let current = node.parent; current; current = current.parent)
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current) || ts.isImportTypeNode(current) || ts.isJSDocImportTag(current))
      return 'import';
  const parent = node.parent;
  if (parent && ts.isBindingElement(parent) && parent.propertyName === node) return 'member';
  if (parent && ts.isPropertyAccessExpression(parent) && parent.name === node) return 'member';
  if (parent && (('name' in parent && parent.name === node) || (ts.isBindingElement(parent) && parent.propertyName === node)))
    return 'declaration';
  for (let current = node.parent; current; current = current.parent) if (ts.isTypeNode(current)) return 'type';
  return 'value';
}

/** Freezes source positions independently of semantic resolution.
 * @param {Pick<import('./model.mjs').File, 'path' | 'text'>} file */
export function frontendSource(file) {
  const text = /** @type {string} */ (file.text),
    sites = new Map();
  /** @type {any[]} */
  const imports = [],
    issues = [];
  /** @param {number} start */
  const location = (start) => {
    const before = text.slice(0, start).split('\n');
    return { line: before.length, column: /** @type {string} */ (before.at(-1)).length + 1 };
  };
  /** @param {number} start @param {number} length @param {string} group @param {string} name @param {string} zone */
  function add(start, length, group, name, zone) {
    sites.set([start, length, group].join(':'), { path: file.path, start, length, ...location(start), group, name, zone });
  }
  /** @param {string} source @param {number} offset @param {string} zone @param {number} [prefix] @param {ts.ScriptKind} [kind] */
  function script(
    source,
    offset,
    zone,
    prefix = 0,
    kind = /[jt]sx$/.test(file.path) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file.path) ? ts.ScriptKind.JS : ts.ScriptKind.TS,
  ) {
    const sf = ts.createSourceFile(file.path, source, ts.ScriptTarget.Latest, true, kind);
    /** @param {ts.Node} node */
    function visit(node) {
      const start = node.getStart(sf) - prefix;
      if (start >= 0 && start < source.length - prefix) {
        if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
          const parent = node.parent;
          const syntax =
            (parent && 'tagName' in parent && parent.tagName === node) ||
            (parent && ts.isNamedTupleMember(parent) && parent.name === node) ||
            (parent && ts.isJSDocParameterTag(parent) && parent.name === node) ||
            (node.text === 'const' && parent && ts.isTypeReferenceNode(parent));
          if (!syntax) add(offset + start, node.getWidth(sf), zone === 'template' ? 'template' : role(node), node.text, zone);
        }
        if (
          zone === 'script' &&
          (ts.isCallExpression(node) || ts.isNewExpression(node)) &&
          node.expression.kind !== ts.SyntaxKind.ImportKeyword
        )
          add(offset + start, node.getWidth(sf), 'call', node.expression.getText(sf), zone);
        let literal;
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) literal = node.moduleSpecifier;
        else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) literal = node.argument.literal;
        else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) literal = node.arguments[0];
        if (literal && ts.isStringLiteralLike(literal))
          imports.push({
            path: file.path,
            start: offset + literal.getStart(sf),
            specifier: literal.text,
            kind: ts.isCallExpression(node) ? 'dynamic' : ts.isImportDeclaration(node) && !node.importClause ? 'side-effect' : 'structure',
            ...location(offset + literal.getStart(sf)),
          });
      }
      ts.forEachChild(node, visit);
      for (const doc of /** @type {ts.Node & {jsDoc?:ts.JSDoc[]}} */ (node).jsDoc ?? []) ts.forEachChild(doc, visit);
    }
    visit(sf);
  }
  if (!file.path.endsWith('.vue')) script(text, 0, 'script');
  else {
    const { descriptor, errors } = parse(text, { filename: file.path });
    issues.push(
      ...errors.map((error) => ({ kind: 'parse', path: file.path, line: null, message: String(error), parser: 'vue/compiler-sfc' })),
    );
    for (const block of [descriptor.script, descriptor.scriptSetup])
      if (block)
        script(block.content, block.loc.start.offset, 'script', 0, block.lang?.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const template = descriptor.template;
    if (template) {
      const tree = baseParse(template.content),
        templateOffset = template.loc.start.offset;
      /** @param {any} node */
      function visit(node) {
        if (node.type === NodeTypes.ELEMENT) {
          if (node.tagType === 1 && node.tag !== 'component')
            add(templateOffset + node.loc.start.offset + 1, node.tag.length, 'component', node.tag, 'template');
          for (const prop of node.props)
            if (prop.type === NodeTypes.DIRECTIVE) {
              if (prop.exp) expression(prop.exp);
              if (prop.arg && !prop.arg.isStatic) expression(prop.arg, 1);
            }
        }
        if (node.type === NodeTypes.INTERPOLATION) expression(node.content);
        for (const child of node.children ?? []) visit(child);
      }
      /** @param {any} value @param {number} [outerOffset] */
      function expression(value, outerOffset = 0) {
        if (value.type === NodeTypes.SIMPLE_EXPRESSION)
          script('(' + value.content + ')', templateOffset + value.loc.start.offset + outerOffset, 'template', 1);
      }
      visit(tree);
    }
  }
  return { sites: /** @type {SourceSite[]} */ ([...sites.values()]), imports, issues };
}
