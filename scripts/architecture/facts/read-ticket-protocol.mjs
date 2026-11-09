import ts from 'typescript';
import { sourceChecker } from '../../shared/frontend-source.mjs';

/** @typedef {{factories:Set<string>, owners:Set<string>, checks:Set<string>, invalidations:Set<string>, promises:Set<string>, signals:Set<string>}} ReadTicketProtocol */

/** @param {ts.Node} node @param {(node:ts.Node)=>void} action */
function walk(node, action) {
  action(node);
  ts.forEachChild(node, (child) => walk(child, action));
}

/** @param {import('./context.mjs').ArchitectureFile | undefined} file @returns {ReadTicketProtocol} */
export function readTicketProtocol(file) {
  const protocol = {
    factories: new Set(),
    owners: new Set(),
    checks: new Set(),
    invalidations: new Set(),
    promises: new Set(),
    signals: new Set(),
  };
  if (!file) return protocol;
  /** @param {ts.Expression} expression @param {string} name @param {ts.TypeChecker} checker @param {Set<ts.Node>} [seen] */
  function globalConstructor(expression, name, checker, seen = new Set()) {
    if (seen.has(expression) || !ts.isIdentifier(expression)) return false;
    seen.add(expression);
    const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration;
    if (!declaration) return expression.text === name;
    if (ts.isVariableDeclaration(declaration) && declaration.initializer)
      return globalConstructor(declaration.initializer, name, checker, seen);
    return false;
  }
  for (const { ast } of file.syntax.scripts) {
    const checker = sourceChecker(ast);
    /** @type {Set<ts.Node>} */
    const factories = new Set();
    for (const fn of ast.statements) {
      if (!ts.isFunctionDeclaration(fn) || !fn.body || !fn.name) continue;
      const controllers = new Set(),
        promises = new Set();
      walk(fn.body, (node) => {
        if (!ts.isVariableDeclaration(node) || !node.initializer || !ts.isNewExpression(node.initializer)) return;
        const type = node.initializer.expression;
        if (!ts.isIdentifier(type)) return;
        if (globalConstructor(type, 'AbortController', checker)) controllers.add(checker.getSymbolAtLocation(node.name));
        if (globalConstructor(type, 'Promise', checker)) promises.add(checker.getSymbolAtLocation(node.name));
      });
      if (!controllers.size || !promises.size) continue;
      const result = fn.body.statements.find(
        (node) => ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression),
      );
      if (!result || !ts.isReturnStatement(result) || !result.expression || !ts.isObjectLiteralExpression(result.expression)) continue;
      const flags = new Set();
      for (const property of result.expression.properties) {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property) && !ts.isMethodDeclaration(property))
          continue;
        const name = property.name?.getText(ast),
          value = ts.isPropertyAssignment(property) ? property.initializer : ts.isMethodDeclaration(property) ? property : property.name;
        if (!name) continue;
        const symbol = ts.isShorthandPropertyAssignment(property)
          ? checker.getShorthandAssignmentValueSymbol(property)
          : checker.getSymbolAtLocation(value);
        if (promises.has(symbol)) protocol.promises.add(name);
        if (
          ts.isPropertyAccessExpression(value) &&
          value.name.text === 'signal' &&
          controllers.has(checker.getSymbolAtLocation(value.expression))
        )
          protocol.signals.add(name);
        let aborts = false;
        walk(value, (node) => {
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === 'abort' &&
            controllers.has(checker.getSymbolAtLocation(node.expression.expression))
          )
            aborts = true;
        });
        if (aborts) {
          protocol.invalidations.add(name);
          walk(value, (node) => {
            if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken)
              flags.add(checker.getSymbolAtLocation(node.left));
          });
        }
      }
      for (const property of result.expression.properties) {
        if (!ts.isPropertyAssignment(property) && !ts.isMethodDeclaration(property)) continue;
        const value = ts.isPropertyAssignment(property) ? property.initializer : property;
        let guards = false,
          throws = false;
        walk(value, (node) => {
          if (ts.isThrowStatement(node)) throws = true;
          if (ts.isIdentifier(node) && flags.has(checker.getSymbolAtLocation(node))) guards = true;
        });
        if (guards && throws) protocol.checks.add(property.name.getText(ast));
      }
      protocol.factories.add(fn.name.text);
      protocol.owners.add(fn.name.text);
      factories.add(fn);
    }
    for (const fn of ast.statements) {
      if (!ts.isFunctionDeclaration(fn) || !fn.body || !fn.name) continue;
      walk(fn.body, (node) => {
        if (
          ts.isCallExpression(node) &&
          factories.has(/** @type {ts.Node} */ (checker.getSymbolAtLocation(node.expression)?.valueDeclaration))
        )
          protocol.owners.add(/** @type {ts.Identifier} */ (fn.name).text);
      });
    }
  }
  return protocol;
}
