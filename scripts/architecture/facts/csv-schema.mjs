import ts from 'typescript';

/** @typedef {{key: string, line: number, column: number}} Key */
/** @typedef {{columns: (Key & {control: string})[], references: (Key & {rule: string, numeric: boolean})[], unknownRules: Key[]}} CsvSchemaFacts */

/** @param {string} path */
export function isCsvSchema(path) {
  return /^schemas\/csv\/[^/]+\.schema\.json$/.test(path);
}

/** @param {ts.Node} node */
function properties(node) {
  return ts.isObjectLiteralExpression(node) ? node.properties.filter(ts.isPropertyAssignment) : [];
}

/** @param {ts.Node} node @param {string} name */
function member(node, name) {
  return properties(node).find((property) => ts.isStringLiteral(property.name) && property.name.text === name)?.initializer;
}

/** @param {{rel: string, text: string}} file @returns {CsvSchemaFacts} */
export function csvSchemaFacts(file) {
  const source = ts.parseJsonText(file.rel, file.text);
  /** @type {CsvSchemaFacts} */
  const facts = { columns: [], references: [], unknownRules: [] };
  /** @param {ts.Node} node @param {string} key */
  function located(node, key) {
    const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
    return { key, line: line + 1, column: character + 1 };
  }
  const root = source.statements[0]?.expression;
  if (!root) return facts;
  const columns = member(root, 'columns');
  if (columns && ts.isArrayLiteralExpression(columns)) {
    for (const column of columns.elements) {
      const key = member(column, 'key'),
        control = member(column, 'control');
      if (key && ts.isStringLiteral(key) && control && ts.isStringLiteral(control)) {
        facts.columns.push({ ...located(key, key.text), control: control.text });
      }
    }
  }
  const validation = member(root, 'validation');
  if (!validation) return facts;
  for (const property of properties(validation)) {
    if (!ts.isStringLiteral(property.name)) continue;
    const rule = property.name.text,
      value = property.initializer;
    if (['integer', 'required', 'requiredColumn', 'script'].includes(rule)) {
      if (ts.isArrayLiteralExpression(value))
        for (const key of value.elements) {
          if (ts.isStringLiteral(key)) facts.references.push({ ...located(key, key.text), rule, numeric: rule === 'integer' });
        }
    } else if (rule === 'warningMin' || rule === 'warningMax') {
      for (const entry of properties(value)) {
        if (ts.isStringLiteral(entry.name)) facts.references.push({ ...located(entry.name, entry.name.text), rule, numeric: true });
      }
    } else facts.unknownRules.push(located(property.name, rule));
  }
  return facts;
}
