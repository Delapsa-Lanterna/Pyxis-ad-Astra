import ts from 'typescript';

/** @param {import('./context.mjs').ArchitectureFile} file @returns {Array<{line:number,column:number}>} */
export function rawSourceTextReads(file) {
  /** @type {Array<{line:number,column:number}>} */
  const reads = [];
  for (const { ast, offset } of file.syntax.scripts) {
    /** @param {ts.Node} node */
    function visit(node) {
      if (
        (ts.isPropertyAccessExpression(node) && node.name.text === 'text') ||
        (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'text')
      )
        reads.push(
          file.positionAt(
            offset + (ts.isPropertyAccessExpression(node) ? node.name.getStart(ast) : node.argumentExpression.getStart(ast) + 1),
          ),
        );
      if (ts.isBindingElement(node) && node.name && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name))) {
        const property = node.propertyName ?? node.name;
        if ((ts.isIdentifier(property) || ts.isStringLiteralLike(property)) && property.text === 'text')
          reads.push(file.positionAt(offset + property.getStart(ast)));
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return reads;
}
