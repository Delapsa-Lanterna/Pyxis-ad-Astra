import ts from 'typescript';

/**
 * @typedef {{ line: number, column: number, handles: Set<string>, accepts: Set<string>, invalidates: Set<string> }} ReadTicketLifecycle
 */

/**
 * Build lifecycle facts for direct ReadTicket creations. The handles are the
 * variables and object properties that carry the created ticket through the
 * current module, so one ticket cannot satisfy another ticket's lifecycle.
 *
 * @param {import('./context.mjs').ArchitectureFile} file
 * @param {readonly {line: number, column: number}[]} creations
 * @returns {ReadTicketLifecycle[]}
 */
export function readTicketLifecycles(file, creations) {
  if (!creations.length) return [];
  /** @type {Map<string, ReadTicketLifecycle>} */
  const byPosition = new Map(
    creations.map((creation) => [
      positionKey(creation),
      {
        ...creation,
        handles: new Set(),
        accepts: new Set(),
        invalidates: new Set(),
      },
    ]),
  );
  /** @type {{ from: string, to: string }[]} */
  const aliases = [];
  const knownPaths = new Set();
  for (const { ast, offset } of file.syntax.scripts) {
    visit(ast, (node) => {
      const path = expressionPath(node);
      if (path) knownPaths.add(path);
      if (ts.isCallExpression(node)) {
        const key = positionKey(positionOf(node, file, ast, offset));
        const lifecycle = byPosition.get(key);
        if (lifecycle) for (const handle of assignmentHandles(node)) lifecycle.handles.add(handle);
        const method = methodCall(node);
        if (method) {
          for (const ticket of byPosition.values()) {
            if (!matchesHandle(method.receiver, ticket.handles)) continue;
            (method.name === 'accept' ? ticket.accepts : ticket.invalidates).add(method.receiver);
          }
        }
      }
      for (const edge of aliasEdges(node)) aliases.push(edge);
    });
  }
  propagateAliases([...byPosition.values()], aliases, knownPaths);
  for (const { ast } of file.syntax.scripts)
    visit(ast, (node) => {
      const method = ts.isCallExpression(node) ? methodCall(node) : null;
      if (!method || (method.name !== 'accept' && method.name !== 'invalidate')) return;
      for (const ticket of byPosition.values()) {
        if (!matchesHandle(method.receiver, ticket.handles)) continue;
        (method.name === 'accept' ? ticket.accepts : ticket.invalidates).add(method.receiver);
      }
    });
  return [...byPosition.values()];
}

/** @param {ts.Node} root @param {(node: ts.Node) => void} callback */
function visit(root, callback) {
  const walk = (/** @type {ts.Node} */ node) => {
    callback(node);
    ts.forEachChild(node, walk);
  };
  walk(root);
}

/** @param {ts.CallExpression} node @returns {{name: string, receiver: string} | null} */
function methodCall(node) {
  if (!ts.isPropertyAccessExpression(node.expression) && !ts.isElementAccessExpression(node.expression)) return null;
  const name = ts.isPropertyAccessExpression(node.expression)
    ? node.expression.name.text
    : ts.isStringLiteralLike(node.expression.argumentExpression)
      ? node.expression.argumentExpression.text
      : null;
  if (name !== 'accept' && name !== 'invalidate') return null;
  return { name, receiver: expressionPath(node.expression.expression) };
}

/** @param {ts.Node} node @returns {{from: string, to: string}[]} */
function aliasEdges(node) {
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const from = expressionPath(node.initializer);
    const to = expressionPath(node.name);
    return from && to ? [{ from, to }, ...objectEdges(node.initializer, [to])] : objectEdges(node.initializer, [to]);
  }
  if (ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind)) {
    const from = expressionPath(node.right);
    const to = expressionPath(node.left);
    return from && to ? [{ from, to }, ...objectEdges(node.right, [to])] : objectEdges(node.right, [to]);
  }
  return [];
}

/** @param {ts.Expression} value @param {string[]} targets @returns {{from: string, to: string}[]} */
function objectEdges(value, targets) {
  if (!ts.isObjectLiteralExpression(value)) return [];
  const edges = [];
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    const source = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
    const from = expressionPath(source);
    if (!name || !from) continue;
    for (const target of targets) edges.push({ from, to: `${target}.${name}` });
  }
  return edges;
}

/** @param {ts.Node} node @returns {string[]} */
function assignmentHandles(node) {
  const handles = [];
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isBinaryExpression(parent) && parent.right === current && isAssignment(parent.operatorToken.kind)) {
      const target = expressionPath(parent.left);
      if (target) handles.push(target);
      current = parent;
      continue;
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
      const target = expressionPath(parent.name);
      if (target) handles.push(target);
      break;
    }
    if (isTransparent(parent, current)) {
      current = parent;
      continue;
    }
    break;
  }
  return handles;
}

/** @param {ReadonlyArray<ReadTicketLifecycle>} tickets @param {{from: string, to: string}[]} aliases @param {ReadonlySet<string>} knownPaths */
function propagateAliases(tickets, aliases, knownPaths) {
  for (const ticket of tickets) {
    const pending = [...ticket.handles];
    while (pending.length) {
      const handle = pending.shift();
      if (!handle) continue;
      for (const { from, to } of aliases) {
        const candidates = handle === from ? [to] : handle.startsWith(`${from}.`) ? [to + handle.slice(from.length)] : [];
        for (const candidate of candidates) {
          if ((candidate.includes('.') && !knownPaths.has(candidate)) || ticket.handles.has(candidate)) continue;
          ticket.handles.add(candidate);
          pending.push(candidate);
        }
      }
    }
  }
}

/** @param {string} receiver @param {ReadonlySet<string>} handles */
function matchesHandle(receiver, handles) {
  if ([...handles].some((handle) => receiver === handle || receiver.endsWith(`.${handle}`))) return true;
  const terminal = receiver.split('.').at(-1);
  return terminal ? [...handles].some((handle) => handle === terminal || handle.endsWith(`.${terminal}`)) : false;
}

/** @param {ts.Node} node @returns {string} */
function expressionPath(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) return node.getText();
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))
    return expressionPath(node.expression);
  if (ts.isPropertyAccessExpression(node)) {
    const base = expressionPath(node.expression);
    return base ? `${base}.${node.name.text}` : '';
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    const base = expressionPath(node.expression);
    return base ? `${base}.${node.argumentExpression.text}` : '';
  }
  return '';
}

/** @param {ts.PropertyName | undefined} name @returns {string} */
function propertyName(name) {
  return name && (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) ? name.text : '';
}

/** @param {number} kind @returns {boolean} */
function isAssignment(kind) {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

/** @param {ts.Node} parent @param {ts.Node} child @returns {boolean} */
function isTransparent(parent, child) {
  return (
    (ts.isParenthesizedExpression(parent) && parent.expression === child) ||
    (ts.isAsExpression(parent) && parent.expression === child) ||
    (ts.isNonNullExpression(parent) && parent.expression === child) ||
    (ts.isSatisfiesExpression(parent) && parent.expression === child) ||
    (ts.isConditionalExpression(parent) && (parent.whenTrue === child || parent.whenFalse === child))
  );
}

/** @param {ts.Node} node @param {import('./context.mjs').ArchitectureFile} file @param {ts.SourceFile} ast @param {number} offset */
function positionOf(node, file, ast, offset) {
  const start = file.text.slice(0, offset + node.getStart(ast)).split('\n');
  return { line: start.length, column: (start.at(-1) ?? '').length + 1 };
}

/** @param {{line: number, column: number}} position @returns {string} */
function positionKey(position) {
  return `${position.line}:${position.column}`;
}
