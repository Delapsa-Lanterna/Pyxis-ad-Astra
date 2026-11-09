import ts from 'typescript';
import { constantString, sourceChecker } from '../../shared/frontend-source.mjs';

/** @param {import('./context.mjs').ArchitectureContext} context @param {string} rel @returns {Map<string,'command'|'save'>} */
export function commandTransportRoles(context, rel) {
  const file = context.byPath.get(rel);
  if (!file) return new Map();
  /** @type {Map<string,{node:ts.FunctionLikeDeclaration,kinds:Set<'command'|'save'>}>} */
  const functions = new Map();
  for (const { ast } of file.syntax.scripts) {
    /** @param {ts.Node} node */
    function collect(node) {
      if (ts.isFunctionDeclaration(node) && node.name && node.body) functions.set(node.name.text, { node, kinds: new Set() });
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
      )
        functions.set(node.name.text, { node: node.initializer, kinds: new Set() });
      ts.forEachChild(node, collect);
    }
    collect(ast);
  }
  for (let pass = 0; pass < functions.size; pass++)
    for (const entry of functions.values()) {
      const checker = sourceChecker(entry.node.getSourceFile());
      /** @param {ts.Node} node @returns {void} */
      function inspect(node) {
        if (!ts.isCallExpression(node)) return ts.forEachChild(node, inspect);
        let native = false;
        if (ts.isIdentifier(node.expression)) {
          const binding = /** @type {import('./context.mjs').ArchitectureFile} */ (file).referenceBindings.get(node.expression.text);
          native = binding?.edge.resolved === '@tauri-apps/api/core' && binding.binding.importedName === 'invoke';
        } else if (
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'invoke' &&
          ts.isIdentifier(node.expression.expression)
        ) {
          const binding = /** @type {import('./context.mjs').ArchitectureFile} */ (file).referenceBindings.get(
            node.expression.expression.text,
          );
          native = binding?.edge.resolved === '@tauri-apps/api/core' && binding.binding.importedName === '*';
        }
        const command = constantString(node.arguments[0], checker);
        if (native) entry.kinds.add(command === 'save_project' ? 'save' : 'command');
        const local = ts.isIdentifier(node.expression) ? checker.getSymbolAtLocation(node.expression)?.valueDeclaration : undefined;
        const target =
          local && ts.isFunctionDeclaration(local)
            ? functions.get(local.name?.text ?? '')
            : local && ts.isVariableDeclaration(local) && ts.isIdentifier(local.name)
              ? functions.get(local.name.text)
              : undefined;
        if (target?.kinds.has('command')) entry.kinds.add(command === 'save_project' ? 'save' : 'command');
        ts.forEachChild(node, inspect);
      }
      inspect(entry.node.body ?? entry.node);
    }
  return new Map(
    file.exports.flatMap((binding) => {
      if (binding.typeOnly) return [];
      const roles = functions.get(binding.localName)?.kinds;
      const role = roles?.has('save') ? 'save' : roles?.has('command') ? 'command' : undefined;
      return role ? [[binding.exportedName, role]] : [];
    }),
  );
}
