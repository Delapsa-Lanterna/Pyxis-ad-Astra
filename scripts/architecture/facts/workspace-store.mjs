import ts from 'typescript';
import { sourceChecker } from '../../shared/frontend-source.mjs';
import { callsFrom } from './imports.mjs';

/** @param {import('./context.mjs').ArchitectureFile} file @param {ReadonlyMap<string,import('./context.mjs').ArchitectureFile>} files @param {string} source @param {ReadonlySet<string>} fields */
export function workspaceStoreWrites(file, files, source, fields) {
  const storeCalls = callsFrom(file, files, new Set([source])).filter((call) => call.origin.name === 'useWorkspaceStore');
  if (!storeCalls.length) return [];
  /** @type {Array<{name:string,line:number,column:number}>} */
  const writes = [];
  for (const { ast, offset } of file.syntax.scripts) {
    const checker = sourceChecker(ast);
    const stores = new Set();
    /** @param {ts.Expression} expression @param {Set<ts.Expression>} [seen] @returns {boolean} */
    function storeValue(expression, seen = new Set()) {
      if (seen.has(expression)) return false;
      seen.add(expression);
      if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression))
        return storeValue(expression.expression, seen);
      if (ts.isIdentifier(expression)) {
        const symbol = checker.getSymbolAtLocation(expression);
        if (symbol && stores.has(symbol)) return true;
        const declaration = symbol?.valueDeclaration;
        return Boolean(
          declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && storeValue(declaration.initializer, seen),
        );
      }
      if (ts.isCallExpression(expression)) {
        const position = file.positionAt(offset + expression.getStart(ast));
        return storeCalls.some((call) => call.line === position.line && call.column === position.column);
      }
      return false;
    }
    /** @param {ts.Expression} expression @param {Set<ts.Expression>} [seen] @returns {boolean} */
    function objectAssign(expression, seen = new Set()) {
      if (seen.has(expression)) return false;
      seen.add(expression);
      if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression)) return objectAssign(expression.expression, seen);
      if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression))
        return (
          expression.name.text === 'assign' &&
          expression.expression.text === 'Object' &&
          !checker.getSymbolAtLocation(expression.expression)?.valueDeclaration
        );
      if (ts.isIdentifier(expression)) {
        const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration;
        return Boolean(
          declaration && ts.isVariableDeclaration(declaration) && declaration.initializer && objectAssign(declaration.initializer, seen),
        );
      }
      return false;
    }
    /** @param {ts.Node} node */
    function visit(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && storeValue(node.initializer)) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol) stores.add(symbol);
      } else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        const value = checker.getSymbolAtLocation(node.initializer),
          symbol = checker.getSymbolAtLocation(node.name);
        if (value && stores.has(value) && symbol) stores.add(symbol);
      }
      if (ts.isCallExpression(node) && objectAssign(node.expression) && node.arguments[0] && storeValue(node.arguments[0])) {
        for (const source of node.arguments.slice(1))
          if (ts.isObjectLiteralExpression(source))
            for (const property of source.properties)
              if (
                property.name &&
                (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) &&
                fields.has(property.name.text)
              )
                writes.push({ name: property.name.text, ...file.positionAt(offset + property.name.getStart(ast)) });
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return writes;
}
