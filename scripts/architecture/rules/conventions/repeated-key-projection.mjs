import ts from 'typescript';
import { defineRule } from '../../diagnostics.mjs';
import { frontendTypes } from '../../facts/frontend-types.mjs';

/** @param {ts.Node} node @param {ts.TypeChecker} checker @returns {ts.Declaration|undefined} */
function invariants(node, checker) {
  if (ts.isPropertyAccessExpression(node) || ts.isNonNullExpression(node) || ts.isParenthesizedExpression(node) || ts.isAsExpression(node))
    return invariants(node.expression, checker);
  return ts.isIdentifier(node) ? checker.getSymbolAtLocation(node)?.declarations?.[0] : undefined;
}

/** Require a visible projection and use the checked domain boundary for calls to other domain helpers.
 * @param {ts.CallExpression} call @param {ts.TypeChecker} checker */
function projectsKeys(call, checker) {
  const declaration = checker.getResolvedSignature(call)?.declaration;
  if (
    !declaration ||
    !(
      ts.isFunctionDeclaration(declaration) ||
      ts.isArrowFunction(declaration) ||
      ts.isMethodDeclaration(declaration) ||
      ts.isFunctionExpression(declaration)
    ) ||
    !declaration.body
  )
    return false;
  const domain = declaration.getSourceFile().fileName.startsWith('src/domain/');
  let projects = false,
    mutates = false;
  /** @param {ts.Node} node */
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const method = ts.isPropertyAccessExpression(node.expression) && node.expression.name.getText();
      if (method === 'map' || method === 'flatMap' || method === 'filter') projects = true;
      else if (!method || !['values', 'from', 'keys', 'entries', 'find', 'includes', 'some'].includes(method)) {
        const callee = checker.getResolvedSignature(node)?.declaration?.getSourceFile().fileName;
        const booleanConversion = node.expression.getText() === 'Boolean' && /(?:^|\/)lib\.es5\.d\.ts$/.test(callee ?? '');
        if (!booleanConversion && (!domain || !callee?.startsWith('src/domain/'))) mutates = true;
      }
    }
    if (
      (ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
      ts.isPostfixUnaryExpression(node) ||
      (ts.isPrefixUnaryExpression(node) &&
        [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].some((kind) => kind === node.operator)) ||
      ts.isAwaitExpression(node) ||
      ts.isThrowStatement(node)
    )
      mutates = true;
    ts.forEachChild(node, visit);
  }
  visit(declaration.body);
  return projects && !mutates;
}

export const repeatedKeyProjectionRule = defineRule(
  'repeated-key-projection',
  '.zcode/frontend-guidelines.md#状态与模块',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend)
      for (const { ast, offset } of file.syntax.scripts) {
        /** @param {ts.Node} node */
        function visit(node) {
          if (
            ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.getText() === 'includes' &&
            ts.isCallExpression(node.expression.expression)
          ) {
            let callback = node.parent;
            while (callback && !ts.isFunctionLike(callback) && !ts.isSourceFile(callback)) callback = callback.parent;
            if (
              (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) &&
              ts.isCallExpression(callback.parent) &&
              ts.isPropertyAccessExpression(callback.parent.expression) &&
              ['filter', 'some', 'every', 'find', 'findIndex', 'map'].includes(callback.parent.expression.name.getText())
            ) {
              const view = frontendTypes(context),
                producer = view.projectNode(node.expression.expression),
                found = view.type(node.expression.expression);
              if (
                producer &&
                ts.isCallExpression(producer) &&
                found &&
                view.checker.isArrayType(found) &&
                projectsKeys(producer, view.checker)
              ) {
                const inputs = [producer.expression, ...producer.arguments];
                if (
                  inputs.every((input) => {
                    if (ts.isLiteralExpression(input)) return true;
                    const declaration = invariants(input, view.checker);
                    return (
                      declaration &&
                      (declaration.getSourceFile() !== producer.getSourceFile() ||
                        declaration.pos < callback.pos ||
                        declaration.end > callback.end)
                    );
                  })
                )
                  report(
                    file,
                    file.positionAt(offset + node.getStart(ast)),
                    'the same array of keys is recomputed for each membership test',
                    { target: producer.expression.getText(), expected: 'compute the key set once before iteration' },
                  );
              }
            }
          }
          ts.forEachChild(node, visit);
        }
        visit(ast);
      }
  },
  'warning',
);
