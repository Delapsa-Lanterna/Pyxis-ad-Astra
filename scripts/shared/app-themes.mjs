import ts from 'typescript';
import { readFileSync } from 'node:fs';

const source = new URL('../../src/shared/types/app-settings.types.ts', import.meta.url);
const ast = ts.createSourceFile(source.pathname, readFileSync(source, 'utf8'), ts.ScriptTarget.Latest, true);
const declaration = /** @type {ts.VariableDeclaration} */ (
  ast.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find((declaration) => declaration.name.getText(ast) === 'APP_THEMES')
);
const array = /** @type {ts.ArrayLiteralExpression} */ (/** @type {ts.AsExpression} */ (declaration.initializer).expression);
export const appThemes = array.elements.map((element) => /** @type {ts.StringLiteral} */ (element).text);
