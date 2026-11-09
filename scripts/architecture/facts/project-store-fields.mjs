import ts from 'typescript';

/** @param {import('./context.mjs').ArchitectureFile} file @param {string} storeId @returns {Array<{name:string,line:number,column:number}>} */
export function piniaStoreFields(file, storeId) {
  /** @type {Array<{name:string,line:number,column:number}>} */
  const fields = [];
  for (const { ast, offset } of file.syntax.scripts) {
    /** @param {ts.Node} node */
    function visit(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        node.arguments[0].text === storeId
      ) {
        const binding = file.referenceBindings.get(node.expression.text);
        if (binding?.edge.resolved === 'pinia' && binding.binding.importedName === 'defineStore') {
          const setup = node.arguments[1];
          if (setup && (ts.isArrowFunction(setup) || ts.isFunctionExpression(setup))) {
            /** @param {ts.Node} body */
            function findReturns(body) {
              if (ts.isFunctionLike(body) && body !== setup) return;
              if (ts.isReturnStatement(body) && body.expression && ts.isObjectLiteralExpression(body.expression))
                for (const property of body.expression.properties)
                  if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)))
                    fields.push({ name: property.name.text, ...file.positionAt(offset + property.name.getStart(ast)) });
              ts.forEachChild(body, findReturns);
            }
            findReturns(setup.body);
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return fields;
}
