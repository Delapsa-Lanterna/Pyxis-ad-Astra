import ts from 'typescript';
import { defineRule } from '../../diagnostics.mjs';
import { frontendTypes } from '../../facts/frontend-types.mjs';
import { sourceChecker } from '../../../shared/frontend-source.mjs';

const maximumBatch = 8192;

/** @param {ts.Expression} value @param {ts.TypeChecker} checker @returns {boolean} */
function bounded(value, checker) {
  if (ts.isArrayLiteralExpression(value)) return value.elements.every((element) => !ts.isSpreadElement(element));
  if (ts.isAsExpression(value) || ts.isParenthesizedExpression(value)) return bounded(value.expression, checker);
  if (ts.isCallExpression(value) && ts.isPropertyAccessExpression(value.expression)) {
    const method = value.expression.name.getText(),
      receiver = value.expression.expression;
    if (method === 'map' || method === 'filter') return bounded(receiver, checker);
    if (method === 'slice') {
      const [start, end] = value.arguments;
      if (!start || !end) return false;
      if (ts.isNumericLiteral(start) && ts.isNumericLiteral(end)) {
        return Number(end.getText().replaceAll('_', '')) - Number(start.getText().replaceAll('_', '')) <= maximumBatch;
      }
      if (
        ts.isIdentifier(start) &&
        ts.isBinaryExpression(end) &&
        end.operatorToken.kind === ts.SyntaxKind.PlusToken &&
        ts.isIdentifier(end.left) &&
        start.getText() === end.left.getText() &&
        ts.isNumericLiteral(end.right)
      ) {
        const binding = checker.getSymbolAtLocation(start);
        return Boolean(
          binding && binding === checker.getSymbolAtLocation(end.left) && Number(end.right.getText().replaceAll('_', '')) <= maximumBatch,
        );
      }
    }
  }
  return false;
}

export const unboundedArgumentsRule = defineRule(
  'unbounded-arguments',
  '.zcode/frontend-guidelines.md#类型与分支设计',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend)
      for (const { ast, offset } of file.syntax.scripts) {
        /** @param {ts.Node} node */
        function visit(node) {
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
            const method = node.expression.name.getText();
            const receiver = node.expression.expression,
              checker = sourceChecker(ast);
            const math =
              (method === 'max' || method === 'min') &&
              ts.isIdentifier(receiver) &&
              receiver.getText() === 'Math' &&
              !checker.getSymbolAtLocation(receiver);
            if (math || method === 'push' || method === 'splice')
              for (const arg of node.arguments.filter(ts.isSpreadElement)) {
                if (bounded(arg.expression, checker)) continue;
                const view = frontendTypes(context),
                  input = view.type(arg.expression);
                if (!input || !view.checker.isArrayType(input) || view.checker.isTupleType(input)) continue;
                if (!math) {
                  const output = view.type(receiver);
                  if (!output || !view.checker.isArrayType(output)) continue;
                }
                report(
                  file,
                  file.positionAt(offset + arg.getStart(ast)),
                  'a variable-length collection is expanded into individual call arguments',
                  {
                    target: math ? 'Math.' + method : 'Array.' + method,
                    expected: 'iterate collection elements or use a bounded batch',
                  },
                );
              }
          }
          ts.forEachChild(node, visit);
        }
        visit(ast);
      }
  },
);
