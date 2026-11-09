import ts from 'typescript';
import { importedTypeOrigins } from './imports.mjs';

/** @param {import('./context.mjs').ArchitectureFile} file @param {ReadonlyMap<string,import('./context.mjs').ArchitectureFile>} files */
export function resourceRefObjects(file, files) {
  /** @type {Array<{line:number,column:number}>} */
  const references = [];
  for (const { ast, offset } of file.syntax.scripts) {
    /** @param {ts.Node} node */
    function visit(node) {
      if (ts.isObjectLiteralExpression(node)) {
        /** @type {string[]} */
        const types = [];
        for (let parent = node.parent; parent && !ts.isFunctionLike(parent) && !ts.isSourceFile(parent); parent = parent.parent) {
          const type =
            ts.isVariableDeclaration(parent) && parent.initializer === node
              ? parent.type
              : (ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent)) && parent.expression === node
                ? parent.type
                : undefined;
          if (type) {
            /** @param {ts.Node} candidate */
            function find(candidate) {
              if (ts.isTypeReferenceNode(candidate) && ts.isIdentifier(candidate.typeName)) types.push(candidate.typeName.text);
              else if (ts.isUnionTypeNode(candidate) || ts.isIntersectionTypeNode(candidate))
                for (const member of candidate.types) find(member);
            }
            find(type);
          }
        }
        if (
          types.some((name) =>
            importedTypeOrigins(file, name, files).some(
              (origin) => origin.name === 'ResourceRef' && origin.rel === 'src/shared/types/project-identity.types.ts',
            ),
          )
        )
          references.push(file.positionAt(offset + node.getStart(ast)));
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  return references;
}
