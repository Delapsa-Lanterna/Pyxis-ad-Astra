import ts from 'typescript';
import { sourcePositions } from '../../shared/source-position.mjs';
import { parseFrontendSource, sourceChecker } from '../../shared/frontend-source.mjs';
import { classifyFrontendPath, frontendFile, specFile } from './classify.mjs';

/** @typedef {{line: number, column: number}} Position */
/** @typedef {Position & {name: string}} Property */
/** @typedef {Position & {type: string, elementType:string}} EmptyTypedArray */
/** @typedef {Position & {name: string, exported: boolean, properties: string[], propertyTypes: ReadonlyMap<string, string[]>}} Declaration */
/** @typedef {Position & {path: string}} Write */
/** @typedef {Position & {value:string,callee:string,argument:number}} StringCall */
/** @typedef {{identifiers: Map<string, Position>, strings: (Position & {value: string})[], stringCalls:StringCall[], properties: Property[], declarations: Declaration[], writes: Write[], emptyTypedArrays: EmptyTypedArray[], tags: Map<string, Position>, conditions: (Position & {expression: string})[], objects: (Position & {properties: string[]})[], throws: (Position & {name: string,builtin:boolean})[], events: (Position & {name: string})[]}} FrontendFacts */

/** @param {import('../../shared/files.mjs').SourceFile} file @param {{onStageTiming?:(timing:{stage:string,durationMs:number,units:number})=>void}} [options] */
export function parseArchitectureFrontend(file, options = {}) {
  const production = frontendFile(file.rel) && !specFile(file.rel);
  const inspect = production || (file.rel.startsWith('scripts/architecture/rules/') && !file.rel.endsWith('.check.mjs'));
  /** @type {FrontendFacts} */
  const frontend = {
    identifiers: new Map(),
    strings: [],
    stringCalls: [],
    properties: [],
    declarations: [],
    writes: [],
    emptyTypedArrays: [],
    tags: new Map(),
    conditions: [],
    objects: [],
    throws: [],
    events: [],
  };
  const {
    identifiers,
    strings,
    stringCalls,
    properties,
    declarations,
    writes,
    emptyTypedArrays,
    tags,
    conditions,
    objects,
    throws,
    events,
  } = frontend;
  const at = sourcePositions(file.text);
  const emitBindings = new Set();
  /** @param {ts.Expression} expression @returns {{name: string} | null} */
  function property(expression) {
    if (ts.isPropertyAccessExpression(expression)) return { name: expression.name.text };
    if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression))
      return { name: expression.argumentExpression.text };
    return null;
  }
  /** @param {ts.Node} node @param {ts.SourceFile} ast @param {number} offset */
  function visit(node, ast, offset) {
    const position = (/** @type {ts.Node} */ node) => at(offset + node.getStart(ast));
    const checker = sourceChecker(ast);
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === 'defineEmits'
    )
      emitBindings.add(node.name.text);

    if (ts.isIdentifier(node)) identifiers.set(node.text, position(node));
    if (
      ts.isVariableDeclaration(node) &&
      node.type &&
      (ts.isArrayTypeNode(node.type) ||
        (ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName) && node.type.typeName.text === 'Array')) &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer) &&
      node.initializer.elements.length === 0
    )
      emptyTypedArrays.push({
        type: node.type.getText(ast),
        elementType: ts.isArrayTypeNode(node.type)
          ? node.type.elementType.getText(ast)
          : (node.type.typeArguments?.[0]?.getText(ast) ?? ''),
        ...position(node),
      });
    if (ts.isStringLiteralLike(node)) {
      strings.push({ value: node.text, ...position(node) });
      for (let current = /** @type {ts.Node} */ (node); current.parent; current = current.parent) {
        const parent = current.parent;
        if (ts.isCallExpression(parent)) {
          const argument = parent.arguments.findIndex(
            (candidate) => candidate === current || (candidate.pos <= node.pos && candidate.end >= node.end),
          );
          if (argument >= 0) stringCalls.push({ value: node.text, callee: parent.expression.getText(ast), argument, ...position(node) });
          break;
        }
        if (ts.isFunctionLike(parent) || ts.isSourceFile(parent)) break;
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const access = property(node);
      if (access) {
        properties.push({ ...access, ...position(node) });
      }
      const parent = node.parent;
      const assignment =
        ts.isBinaryExpression(parent) &&
        parent.left === node &&
        parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
      if (assignment) writes.push({ path: node.getText(ast), ...position(node) });
    }
    if (
      (ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node)) &&
      node.name
    ) {
      const members =
        ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)
          ? node.members
          : ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)
            ? node.type.members
            : [];
      const propertyTypes = new Map();
      if (
        ts.isInterfaceDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type))
      )
        for (const member of members) {
          if (!member.name || !(ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) || !member.type) continue;
          const memberTypes = new Set();
          if (ts.isTypeReferenceNode(member.type)) memberTypes.add(member.type.typeName.getText(ast));
          member.type.forEachChild((/** @param {ts.Node} child */ child) => {
            if (ts.isTypeReferenceNode(child)) memberTypes.add(child.typeName.getText(ast));
          });
          propertyTypes.set(member.name.getText(ast), [...memberTypes]);
        }
      declarations.push({
        name: node.name.text,
        exported: ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false,
        properties: members.flatMap((member) =>
          member.name && (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name)) ? [member.name.text] : [],
        ),
        propertyTypes,
        ...position(node),
      });
    }
    if (ts.isObjectLiteralExpression(node))
      objects.push({
        properties: node.properties.flatMap((property) =>
          property.name && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) ? [property.name.text] : [],
        ),
        ...position(node),
      });
    if (ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression)) {
      /** @param {ts.Expression} expression @param {Set<ts.Node>} [seen] */
      const builtinError = (expression, seen = new Set()) => {
        if (seen.has(expression) || !ts.isIdentifier(expression)) return false;
        seen.add(expression);
        const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration;
        if (!declaration) return expression.text === 'Error';
        if (ts.isVariableDeclaration(declaration) && declaration.initializer) return builtinError(declaration.initializer, seen);
        return false;
      };
      throws.push({ name: node.expression.expression.getText(ast), builtin: builtinError(node.expression.expression), ...position(node) });
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (node.expression.text === 'defineEmits') {
        const type = node.typeArguments?.[0];
        if (type && ts.isTypeLiteralNode(type))
          for (const member of type.members)
            if (member.name && (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name)))
              events.push({ name: member.name.text, ...position(member) });
      }
      if (
        (emitBindings.has(node.expression.text) || node.expression.text === '$emit') &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      )
        events.push({ name: node.arguments[0].text, ...position(node) });
    }
  }
  const parsed = parseFrontendSource(file, {
    inspect: !specFile(file.rel),
    references: production,
    onNode: inspect ? visit : undefined,
    onStageTiming: options.onStageTiming,
  });
  const markup = parsed.syntax.template;
  if (inspect && markup) {
    /** @param {import('@vue/compiler-dom').RootNode | import('@vue/compiler-dom').TemplateChildNode} node */
    function template(node) {
      if (node.type === 1) {
        tags.set(node.tag, at(node.loc.start.offset));
        for (const prop of node.props) {
          if (prop.type === 7 && prop.exp?.type === 4 && ['if', 'else-if'].includes(prop.name))
            conditions.push({ expression: prop.exp.content, ...at(prop.loc.start.offset) });
        }
        for (const child of node.children) template(child);
      } else if (node.type === 0) for (const child of node.children) template(child);
    }
    template(markup.ast);
  }
  return {
    ...parsed,
    positionAt: at,
    frontend,
    role: classifyFrontendPath(file.rel),
    parses: { frontend: parsed.syntax.scripts.length, templates: inspect && parsed.syntax.template ? 1 : 0 },
  };
}
