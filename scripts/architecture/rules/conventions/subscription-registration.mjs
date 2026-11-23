import ts from 'typescript';
import { defineRule } from '../../diagnostics.mjs';
import { sourceChecker } from '../../../shared/frontend-source.mjs';

/** @param {ts.Node} node @param {(node: ts.Node) => boolean} matches @returns {boolean} */
function contains(node, matches) {
  return matches(node) || (!ts.isFunctionLike(node) && Boolean(ts.forEachChild(node, (child) => contains(child, matches) || undefined)));
}

/** @param {ts.Node} node @param {ts.TypeChecker} checker @returns {ts.Expression | undefined} */
function initializer(node, checker) {
  const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
  return declaration && ts.isVariableDeclaration(declaration) && declaration.parent.flags & ts.NodeFlags.Const
    ? declaration.initializer
    : undefined;
}

/** Return a stable identity for a structured receiver or callback inside the same lexical scope.
 * @param {ts.Expression} node @param {ts.TypeChecker} checker @returns {string | undefined} */
function binding(node, checker) {
  if (ts.isIdentifier(node) || node.kind === ts.SyntaxKind.ThisKeyword)
    return String(checker.getSymbolAtLocation(node)?.valueDeclaration?.pos ?? node.getText());
  if (ts.isPropertyAccessExpression(node)) {
    const receiver = binding(node.expression, checker);
    if (receiver !== undefined) return receiver + '.' + node.name.getText();
  }
  return undefined;
}

/** @param {ts.Node} node @param {string} method @param {ts.TypeChecker} checker */
function registrationKey(node, method, checker) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.getText() !== method) return;
  const receiver = binding(node.expression.expression, checker);
  if (receiver === undefined || !node.arguments.length) return;
  const args = node.arguments.slice(0, method === 'delete' || method === 'add' ? 1 : 2);
  const keys = args.map((arg) => (ts.isStringLiteralLike(arg) ? arg.getText().slice(1, -1) : binding(arg, checker)));
  return keys.every((key) => key !== undefined) ? JSON.stringify([receiver, ...keys]) : undefined;
}

/** The acquired callback must be invoked on every rejection branch.
 * @param {ts.Statement} block @param {(node:ts.Node)=>boolean} release @returns {boolean} */
function releases(block, release) {
  if (!ts.isBlock(block)) return ts.isExpressionStatement(block) && release(block.expression);
  for (const statement of block.statements) {
    if (ts.isExpressionStatement(statement) && release(statement.expression)) return true;
    if (ts.isIfStatement(statement)) {
      if (statement.elseStatement && releases(statement.thenStatement, release) && releases(statement.elseStatement, release)) return true;
      if (contains(statement, (node) => ts.isReturnStatement(node) || ts.isThrowStatement(node))) return false;
    }
    if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement)) return !!statement.expression && release(statement.expression);
  }
  return false;
}

/** @param {ts.Node} wait @param {ts.Block} scope @param {(node:ts.Node)=>boolean} release */
function rollsBack(wait, scope, release) {
  for (let node = wait; node !== scope; node = node.parent) {
    const parent = node.parent;
    if (
      ts.isTryStatement(parent) &&
      parent.tryBlock === node &&
      ((parent.catchClause && releases(parent.catchClause.block, release)) ||
        (parent.finallyBlock && releases(parent.finallyBlock, release)))
    )
      return true;
  }
  return false;
}

/** @param {ts.Block} body @param {ts.TypeChecker} checker @param {(wait:ts.Node)=>void} report */
function checkFactory(body, checker, report) {
  const waits = /** @type {ts.AwaitExpression[]} */ ([]);
  const calls = /** @type {ts.CallExpression[]} */ ([]);
  const returned = /** @type {ts.Expression[]} */ ([]);
  contains(body, (node) => {
    if (ts.isAwaitExpression(node)) waits.push(node);
    if (ts.isCallExpression(node)) calls.push(node);
    if (ts.isReturnStatement(node) && node.expression) returned.push(node.expression);
    return false;
  });
  for (const handle of returned) {
    const creation = ts.isIdentifier(handle) ? initializer(handle, checker) : handle;
    if (!creation) continue;
    /** @type {ts.Node | undefined} */
    let acquired;
    /** @type {(node:ts.Node)=>boolean} */
    let release;
    if (ts.isIdentifier(handle) && ts.isCallExpression(creation)) {
      const signature = checker.getResolvedSignature(creation);
      const factory = signature?.getDeclaration();
      const unsubscribe =
        signature &&
        checker
          .getReturnTypeOfSignature(signature)
          .getCallSignatures()
          .some((callback) => !callback.parameters.length && checker.getReturnTypeOfSignature(callback).flags & ts.TypeFlags.Void);
      const registers =
        factory &&
        'body' in factory &&
        factory.body &&
        ts.isBlock(factory.body) &&
        contains(
          factory.body,
          (node) => registrationKey(node, 'add', checker) !== undefined || registrationKey(node, 'addEventListener', checker) !== undefined,
        );
      if (!unsubscribe || !registers) continue;
      acquired = creation;
      release = (node) => ts.isCallExpression(node) && binding(node.expression, checker) === binding(handle, checker);
    } else if (ts.isArrowFunction(creation) || ts.isFunctionExpression(creation)) {
      const operations = new Set();
      contains(creation.body, (node) => {
        for (const [remove, add] of /** @type {const} */ ([
          ['delete', 'add'],
          ['removeEventListener', 'addEventListener'],
        ])) {
          const key = registrationKey(node, remove, checker);
          if (key !== undefined) operations.add(add + key);
        }
        return false;
      });
      acquired = calls.find((call) =>
        ['add', 'addEventListener'].some((method) => operations.has(method + registrationKey(call, method, checker))),
      );
      release = (node) =>
        (ts.isIdentifier(handle) && ts.isCallExpression(node) && binding(node.expression, checker) === binding(handle, checker)) ||
        operations.has('add' + registrationKey(node, 'delete', checker)) ||
        operations.has('addEventListener' + registrationKey(node, 'removeEventListener', checker));
    }
    if (!acquired) continue;
    const wait = waits.find((wait) => wait.pos >= acquired.end && wait.end <= handle.pos && !rollsBack(wait, body, release));
    if (wait) report(wait);
  }
}

export const subscriptionRegistrationRule = defineRule(
  'subscription-registration',
  '.zcode/modules/project-sync.md#规范',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      for (const { ast, offset } of file.syntax.scripts) {
        /** @param {ts.Node} node */
        function visit(node) {
          if (
            (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) &&
            node.body &&
            ts.isBlock(node.body) &&
            node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.AsyncKeyword)
          )
            checkFactory(node.body, sourceChecker(ast), (wait) =>
              report(
                file,
                file.positionAt(offset + wait.getStart(ast)),
                'failed readiness must release a subscription acquired before its handle is returned',
                { expected: 'release the same registration on rejection' },
              ),
            );
          ts.forEachChild(node, visit);
        }
        visit(ast);
      }
    }
  },
);
