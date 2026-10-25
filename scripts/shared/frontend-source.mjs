import ts from 'typescript';
import { sourcePositions } from './source-position.mjs';
import { parse } from 'vue/compiler-sfc';

/** @typedef {{ importedName: string | null, localName: string | null, specifier: string, typeOnly: boolean, kind: 'import' | 'export' | 'dynamic' | 'type', line: number, column: number }} ImportSpecifierInfo */
/** @typedef {{ exportedName: string, localName: string, specifier: string | null, importedName: string, typeOnly: boolean, line: number, column: number }} ExportBinding */
/** @typedef {{ localName: string | null, member: string | null, specifier: string | null, arguments: (string | null)[], argumentExpressions: (string | null)[], factory: boolean, line: number, column: number }} SourceCall */
/** @typedef {{line: number, column: number, message: string, target?: string, symbol?: string, expected?: string}} SourceFailure */
/** @typedef {Omit<SourceCall, 'arguments' | 'argumentExpressions'> & {write: boolean}} SourceAccess */
/** @typedef {{ imports: ImportSpecifierInfo[], exports: ExportBinding[], exportedFunctions: string[], calls: SourceCall[], accesses: SourceAccess[], dependencyFailures: SourceFailure[], syntax: {scripts: {ast: ts.SourceFile, offset: number}[], template: {text: string, offset: number, ast: import('@vue/compiler-dom').RootNode} | null, styles: import('@vue/compiler-sfc').SFCStyleBlock[]} }} FrontendSource */

/** @param {import('./files.mjs').SourceFile} file @param {{references?: boolean, inspect?: boolean, onNode?: (node: ts.Node, ast: ts.SourceFile, offset: number) => void}} [options] @returns {FrontendSource} */
export function parseFrontendSource(file, { references = true, inspect = true, onNode } = {}) {
  /** @type {FrontendSource} */
  const facts = {
    imports: [],
    exports: [],
    exportedFunctions: [],
    calls: [],
    accesses: [],
    dependencyFailures: [],
    syntax: { scripts: [], template: null, styles: [] },
  };
  const positionAt = sourcePositions(file.text);
  if (!inspect || !/\.(?:ts|tsx|js|jsx|mjs|vue)$/.test(file.rel)) return facts;
  const { blocks, template, styles } = scriptBlocks(file);
  facts.syntax.template = template;
  facts.syntax.styles = styles;
  for (const block of blocks) {
    const ast = ts.createSourceFile(file.rel, block.text, ts.ScriptTarget.Latest, true, block.kind);
    facts.syntax.scripts.push({ ast, offset: block.offset });
    /** @type {Map<ts.Node, Map<string, ts.Expression | null>>} */
    const scopes = new Map();
    /** @param {ts.Node} node @returns {ts.Node} */
    function scopeOf(node) {
      let scope = node.parent;
      while (scope && !ts.isSourceFile(scope) && !ts.isBlock(scope) && !ts.isFunctionLike(scope)) scope = scope.parent;
      return scope ?? ast;
    }
    /** @param {ts.Node} node @param {string} name @param {ts.Expression | null} expression */
    function bindAlias(node, name, expression) {
      const scope = scopeOf(node);
      const bindings = scopes.get(scope) ?? new Map();
      bindings.set(name, expression);
      scopes.set(scope, bindings);
    }
    /** @param {ts.Node} node */
    function collectAliases(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) bindAlias(node, node.name.text, node.initializer ?? null);
      if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer) {
        for (const element of node.name.elements) {
          if (ts.isIdentifier(element.name) && !element.dotDotDotToken) {
            const member = element.propertyName?.getText(ast) ?? element.name.text;
            bindAlias(node, element.name.text, ts.factory.createPropertyAccessExpression(node.initializer, member));
          }
        }
      }
      if (ts.isParameter(node)) {
        if (ts.isIdentifier(node.name)) bindAlias(node, node.name.text, null);
        if (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name))
          for (const element of node.name.elements)
            if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) bindAlias(node, element.name.text, null);
      }
      if (ts.isFunctionDeclaration(node) && node.name) bindAlias(node, node.name.text, null);
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        ts.isIdentifier(node.left)
      )
        bindAlias(node, node.left.text, node.right);
      ts.forEachChild(node, collectAliases);
    }
    if (references) collectAliases(ast);
    /** @type {Map<ts.Expression, ReturnType<typeof resolveTarget>>} */
    const targets = new Map();
    /** @param {ts.Expression} expression @param {Set<string>} [seen] @returns {{localName: string | null, member: string | null, specifier: string | null, factory: boolean} | null} */
    function callTarget(expression, seen = new Set()) {
      const cached = targets.get(expression);
      if (cached !== undefined) return cached;
      const target = resolveTarget(expression, seen);
      targets.set(expression, target);
      return target;
    }
    /** @param {ts.Expression} expression @param {Set<string>} seen @returns {{localName: string | null, member: string | null, specifier: string | null, factory: boolean} | null} */
    function resolveTarget(expression, seen) {
      if (
        ts.isParenthesizedExpression(expression) ||
        ts.isAwaitExpression(expression) ||
        ts.isAsExpression(expression) ||
        ts.isNonNullExpression(expression) ||
        ts.isSatisfiesExpression(expression)
      )
        return callTarget(expression.expression, seen);
      if (ts.isIdentifier(expression)) {
        let scope = scopeOf(expression);
        while (scope) {
          const bindings = scopes.get(scope);
          if (bindings?.has(expression.text)) {
            const alias = bindings.get(expression.text);
            return alias && !seen.has(expression.text) ? callTarget(alias, new Set(seen).add(expression.text)) : null;
          }
          if (ts.isSourceFile(scope)) break;
          scope = scopeOf(scope);
        }
        return { localName: expression.text, member: null, specifier: null, factory: false };
      }
      if (ts.isPropertyAccessExpression(expression)) {
        const source = callTarget(expression.expression, seen);
        return source ? { ...source, member: expression.name.text } : null;
      }
      if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) {
        const source = callTarget(expression.expression, seen);
        return source ? { ...source, member: expression.argumentExpression.text } : null;
      }
      if (ts.isCallExpression(expression) && expression.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = expression.arguments[0];
        if (argument && ts.isStringLiteralLike(argument))
          return { localName: null, member: null, specifier: argument.text, factory: false };
      }
      if (ts.isCallExpression(expression)) {
        const source = callTarget(expression.expression, seen);
        return source ? { ...source, factory: true } : null;
      }
      return null;
    }
    /** @param {ts.Expression | undefined} expression @param {string} name */
    function localExport(expression, name) {
      const target = references && expression ? callTarget(expression) : null;
      return target && !target.factory
        ? { localName: target.localName ?? name, importedName: target.member ?? '*' }
        : { localName: name, importedName: name };
    }
    /** @param {ts.Node} node @returns {void} */
    function visit(node) {
      onNode?.(node, ast, block.offset);
      if (references && ts.isCallExpression(node) && node.expression.kind !== ts.SyntaxKind.ImportKeyword) {
        const target = callTarget(node.expression);
        if (target) {
          const position = positionAt(block.offset + node.getStart(ast));
          facts.calls.push({
            ...target,
            arguments: node.arguments.map((argument) => (ts.isStringLiteralLike(argument) ? argument.text : null)),
            argumentExpressions: node.arguments.map((argument) =>
              ts.isStringLiteralLike(argument) || ts.isPropertyAccessExpression(argument) || ts.isElementAccessExpression(argument)
                ? argument.getText(ast)
                : null,
            ),
            ...position,
          });
        }
      }
      if (references && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
        const target = callTarget(node);
        const parent = node.parent;
        const write =
          (ts.isBinaryExpression(parent) &&
            parent.left === node &&
            parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
            parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
          ts.isDeleteExpression(parent) ||
          ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
            (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken));
        if (target) facts.accesses.push({ ...target, ...positionAt(block.offset + node.getStart(ast)), write });
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const specifier = node.moduleSpecifier.text;
        const clause = node.importClause;
        if (!clause) addImport(node, specifier, null, null, false, 'import');
        else {
          if (clause.name) addImport(node, specifier, 'default', clause.name.text, clause.isTypeOnly, 'import');
          const bindings = clause.namedBindings;
          if (bindings && ts.isNamespaceImport(bindings)) addImport(node, specifier, '*', bindings.name.text, clause.isTypeOnly, 'import');
          if (bindings && ts.isNamedImports(bindings)) {
            for (const binding of bindings.elements)
              addImport(
                binding,
                specifier,
                binding.propertyName?.text ?? binding.name.text,
                binding.name.text,
                clause.isTypeOnly || binding.isTypeOnly,
                'import',
              );
          }
          if (!clause.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length === 0)
            addImport(node, specifier, null, null, clause.isTypeOnly, 'import');
        }
      } else if (ts.isExportDeclaration(node)) {
        const specifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
        const clause = node.exportClause;
        if (!clause && specifier) {
          addImport(node, specifier, '*', null, node.isTypeOnly, 'export');
          facts.exports.push({
            ...positionAt(block.offset + node.getStart(ast)),
            exportedName: '*',
            localName: '*',
            specifier,
            importedName: '*',
            typeOnly: node.isTypeOnly,
          });
        } else if (clause && ts.isNamedExports(clause)) {
          for (const binding of clause.elements) {
            const importedName = binding.propertyName?.text ?? binding.name.text;
            const typeOnly = node.isTypeOnly || binding.isTypeOnly;
            if (specifier) addImport(binding, specifier, importedName, null, typeOnly, 'export');
            facts.exports.push({
              ...positionAt(block.offset + node.getStart(ast)),
              exportedName: binding.name.text,
              ...(specifier ? { localName: importedName, importedName } : localExport(binding.propertyName ?? binding.name, importedName)),
              specifier,
              typeOnly,
            });
          }
        } else if (clause && ts.isNamespaceExport(clause) && specifier) {
          addImport(node, specifier, '*', null, node.isTypeOnly, 'export');
          facts.exports.push({
            ...positionAt(block.offset + node.getStart(ast)),
            exportedName: clause.name.text,
            localName: '*',
            specifier,
            importedName: '*',
            typeOnly: node.isTypeOnly,
          });
        }
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
        addImport(node, node.argument.literal.text, node.qualifier?.getText(ast) ?? '*', null, true, 'type');
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) addImport(node, argument.text, '*', null, false, 'dynamic');
        else {
          const position = positionAt(block.offset + node.getStart(ast));
          facts.dependencyFailures.push({
            ...position,
            message: 'dynamic dependencies must declare a literal module specifier for capability authorization',
            target: node.getText(ast),
            symbol: 'import',
            expected: 'literal module specifier',
          });
        }
      }
      if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
        const isDefault = ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false;
        if (
          ts.isFunctionDeclaration(node) ||
          ts.isClassDeclaration(node) ||
          ts.isInterfaceDeclaration(node) ||
          ts.isTypeAliasDeclaration(node) ||
          ts.isEnumDeclaration(node)
        ) {
          const name = isDefault ? 'default' : node.name?.text;
          if (name) {
            facts.exports.push({
              ...positionAt(block.offset + node.getStart(ast)),
              exportedName: name,
              localName: node.name?.text ?? name,
              specifier: null,
              importedName: name,
              typeOnly: ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node),
            });
            if (ts.isFunctionDeclaration(node)) facts.exportedFunctions.push(name);
          }
        } else if (ts.isVariableStatement(node)) {
          for (const declaration of node.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name)) continue;
            const name = declaration.name.text;
            facts.exports.push({
              ...positionAt(block.offset + node.getStart(ast)),
              exportedName: name,
              ...localExport(declaration.initializer, name),
              specifier: null,
              typeOnly: false,
            });
            if (
              declaration.initializer &&
              (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
            )
              facts.exportedFunctions.push(name);
          }
        }
      }
      if (ts.isExportAssignment(node))
        facts.exports.push({
          ...positionAt(block.offset + node.getStart(ast)),
          exportedName: 'default',
          ...localExport(node.expression, 'default'),
          specifier: null,
          typeOnly: false,
        });
      ts.forEachChild(node, visit);
    }
    /** @param {ts.Node} node @param {string} specifier @param {string | null} importedName @param {string | null} localName @param {boolean} typeOnly @param {ImportSpecifierInfo['kind']} kind */
    function addImport(node, specifier, importedName, localName, typeOnly, kind) {
      const position = block.offset + node.getStart(ast);
      const location = positionAt(position);
      facts.imports.push({
        importedName,
        localName,
        specifier,
        typeOnly,
        kind,
        ...location,
      });
    }
    visit(ast);
  }
  return facts;
}

/** @param {import('./files.mjs').SourceFile} file @returns {{blocks: {text: string, offset: number, kind: ts.ScriptKind}[], template: {text: string, offset: number, ast: import('@vue/compiler-dom').RootNode} | null, styles: import('@vue/compiler-sfc').SFCStyleBlock[]}} */
function scriptBlocks(file) {
  if (!file.rel.endsWith('.vue'))
    return { blocks: [{ text: file.text, offset: 0, kind: scriptKind(file.rel.split('.').at(-1)) }], template: null, styles: [] };
  const { descriptor, errors } = parse(file.text, { filename: file.rel });
  if (errors.length)
    throw new Error(`${file.rel}: ${errors.map((error) => (typeof error === 'string' ? error : error.message)).join('; ')}`);
  return {
    styles: descriptor.styles,
    template: descriptor.template
      ? {
          text: descriptor.template.content,
          offset: descriptor.template.loc.start.offset,
          ast: /** @type {import('@vue/compiler-dom').RootNode} */ (descriptor.template.ast),
        }
      : null,
    blocks: [descriptor.script, descriptor.scriptSetup].flatMap((block) =>
      block ? [{ text: block.content, offset: block.loc.start.offset, kind: scriptKind(block.lang ?? 'js') }] : [],
    ),
  };
}

/** @param {string | undefined} language @returns {ts.ScriptKind} */
function scriptKind(language) {
  if (language === 'tsx') return ts.ScriptKind.TSX;
  if (language === 'jsx') return ts.ScriptKind.JSX;
  return language === 'ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}
