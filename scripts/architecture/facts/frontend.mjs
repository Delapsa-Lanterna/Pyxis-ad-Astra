import ts from 'typescript';
import { baseParse } from '@vue/compiler-dom';
import { sourcePositions } from '../../shared/source-position.mjs';
import { parseFrontendSource } from '../../shared/frontend-source.mjs';
import { classifyFrontendPath, frontendFile, specFile } from './classify.mjs';

/** @typedef {{line: number, column: number}} Position */
/** @typedef {Position & {name: string}} Property */
/** @typedef {Position & {type: string}} EmptyTypedArray */
/** @typedef {Position & {name: string, exported: boolean, properties: string[], types: string[], propertyTypes: ReadonlyMap<string, string[]>}} Declaration */
/** @typedef {Position & {path: string}} Write */
/** @typedef {{identifiers: ReadonlyMap<string, Position>, strings: (Position & {value: string})[], properties: Property[], methodCalls: Property[], declarations: Declaration[], writes: Write[], emptyTypedArrays: EmptyTypedArray[], tags: ReadonlyMap<string, Position>, conditions: (Position & {expression: string})[], objects: (Position & {properties: string[]})[], throws: (Position & {name: string})[], events: (Position & {name: string})[]}} FrontendFacts */

/** @param {import('../../shared/files.mjs').SourceFile & import('../../shared/frontend-source.mjs').FrontendSource} file @param {boolean} [inspect] @returns {FrontendFacts} */
export function frontendFacts(file, inspect = true) {
  /** @type {Map<string, Position>} */
  const identifiers = new Map();
  /** @type {FrontendFacts['strings']} */
  const strings = [];
  /** @type {FrontendFacts['properties']} */
  const properties = [];
  /** @type {FrontendFacts['methodCalls']} */
  const methodCalls = [];
  /** @type {FrontendFacts['declarations']} */
  const declarations = [];
  /** @type {FrontendFacts['writes']} */
  const writes = [];
  /** @type {FrontendFacts['emptyTypedArrays']} */
  const emptyTypedArrays = [];
  /** @type {Map<string, Position>} */
  const tags = new Map();
  /** @type {FrontendFacts['conditions']} */
  const conditions = [];
  /** @type {FrontendFacts['objects']} */
  const objects = [];
  /** @type {FrontendFacts['throws']} */
  const throws = [];
  /** @type {FrontendFacts['events']} */
  const events = [];
  const facts = {
    identifiers,
    strings,
    properties,
    methodCalls,
    declarations,
    writes,
    emptyTypedArrays,
    tags,
    conditions,
    objects,
    throws,
    events,
  };
  if (!inspect) return facts;
  const at = sourcePositions(file.text);
  for (const { ast, offset } of file.syntax.scripts) {
    /** @param {ts.Node} node @returns {Position} */
    const position = (node) => at(offset + node.getStart(ast));
    /** @param {ts.Expression} expression @returns {{name: string} | null} */
    function property(expression) {
      if (ts.isPropertyAccessExpression(expression)) return { name: expression.name.text };
      if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression))
        return { name: expression.argumentExpression.text };
      return null;
    }
    const emitBindings = new Set(
      ast.statements
        .filter(ts.isVariableStatement)
        .flatMap((statement) => [...statement.declarationList.declarations])
        .filter(
          (declaration) =>
            declaration.initializer &&
            ts.isCallExpression(declaration.initializer) &&
            ts.isIdentifier(declaration.initializer.expression) &&
            declaration.initializer.expression.text === 'defineEmits',
        )
        .map((declaration) => declaration.name.getText(ast)),
    );
    /** @param {ts.Node} node @returns {void} */
    function visit(node) {
      if (ts.isIdentifier(node)) identifiers.set(node.text, position(node));
      if (
        ts.isVariableDeclaration(node) &&
        node.type &&
        ts.isArrayTypeNode(node.type) &&
        node.initializer &&
        ts.isArrayLiteralExpression(node.initializer) &&
        node.initializer.elements.length === 0
      )
        emptyTypedArrays.push({ type: node.type.getText(ast), ...position(node) });
      if (ts.isStringLiteralLike(node)) strings.push({ value: node.text, ...position(node) });
      if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
        const access = property(node);
        if (access) {
          properties.push({ ...access, ...position(node) });
          if (ts.isCallExpression(node.parent) && node.parent.expression === node) methodCalls.push({ ...access, ...position(node) });
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
        const types = new Set();
        const propertyTypes = new Map();
        /** @param {ts.Node} child */
        function typeNames(child) {
          if (ts.isTypeReferenceNode(child)) types.add(child.typeName.getText(ast));
          ts.forEachChild(child, typeNames);
        }
        if (!ts.isFunctionDeclaration(node)) typeNames(node);
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
          types: [...types],
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
      if (ts.isThrowStatement(node) && node.expression && ts.isNewExpression(node.expression))
        throws.push({ name: node.expression.expression.getText(ast), ...position(node) });
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
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  const markup = file.syntax.template;
  if (markup) {
    const templateOffset = markup.offset;
    /** @param {import('@vue/compiler-dom').RootNode | import('@vue/compiler-dom').TemplateChildNode} node */
    function template(node) {
      if (node.type === 1) {
        tags.set(node.tag, at(templateOffset + node.loc.start.offset));
        for (const prop of node.props) {
          if (prop.type === 7 && prop.exp?.type === 4 && ['if', 'else-if'].includes(prop.name))
            conditions.push({ expression: prop.exp.content, ...at(templateOffset + prop.loc.start.offset) });
        }
        for (const child of node.children) template(child);
      } else if (node.type === 0) for (const child of node.children) template(child);
    }
    template(baseParse(markup.text));
  }
  return facts;
}

/** @param {import('../../shared/files.mjs').SourceFile} file */
export function parseArchitectureFrontend(file) {
  const production = frontendFile(file.rel) && !specFile(file.rel);
  const parsed = parseFrontendSource(file, { references: production });
  const inspect = production || (file.rel.startsWith('scripts/architecture/rules/') && !file.rel.endsWith('.check.mjs'));
  const frontend = frontendFacts({ ...file, ...parsed }, inspect);
  return {
    ...parsed,
    frontend,
    role: classifyFrontendPath(file.rel),
    parses: { frontend: parsed.syntax.scripts.length, templates: inspect && parsed.syntax.template ? 1 : 0 },
  };
}
