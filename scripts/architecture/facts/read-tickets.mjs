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
 * @param {ReadonlyMap<string, import('./context.mjs').ArchitectureFile>} [files]
 * @returns {ReadTicketLifecycle[]}
 */
export function readTicketLifecycles(file, creations, files = new Map([[file.rel, file]])) {
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
  /** @type {{ from: string, to: string, directed?: boolean }[]} */
  const aliases = [];
  /** @type {{name: string, receiver: string}[]} */
  const methods = [];
  for (const { ast, offset } of file.syntax.scripts) {
    const checker = sourceChecker(ast);
    const channels = collectionChannels(ast, checker, offset, file, files);
    /** @param {ts.Node} node @returns {string} */
    const pathOf = (node) => expressionPath(node, checker, offset, channels);
    visit(ast, (node) => {
      if (ts.isCallExpression(node)) {
        const key = positionKey(positionOf(node, file, ast, offset));
        const lifecycle = byPosition.get(key);
        if (lifecycle) for (const handle of assignmentHandles(node, pathOf)) lifecycle.handles.add(handle);
        const method = methodCall(node, pathOf);
        if (method) methods.push(method);
      }
      for (const edge of aliasEdges(node, pathOf)) aliases.push(edge);
      if (ts.isElementAccessExpression(node) && !ts.isStringLiteralLike(node.argumentExpression)) {
        const base = pathOf(node.expression);
        for (const property of checker.getTypeAtLocation(node.expression).getProperties())
          aliases.push({ from: `${base}.${property.name}`, to: pathOf(node) });
      }
      if (ts.isCallExpression(node)) {
        const declaration = checker.getSymbolAtLocation(node.expression)?.valueDeclaration;
        if (declaration && ts.isFunctionLike(declaration))
          declaration.parameters.forEach((parameter, index) => {
            const argument = node.arguments[index];
            if (argument) aliases.push(...valueEdges(argument, pathOf(parameter.name), pathOf));
          });
        if (ts.isPropertyAccessExpression(node.expression)) {
          const name = node.expression.name.text;
          const channel = channels.get(pathOf(node.expression));
          const value =
            channel?.argument !== undefined
              ? node.arguments[channel.argument]
              : name === 'set'
                ? node.arguments[1]
                : name === 'add'
                  ? node.arguments[0]
                  : undefined;
          if (value) {
            const storage = channel?.path ?? pathOf(node.expression.expression);
            const key = channel ? node.arguments[channel.key] : name === 'set' ? node.arguments[0] : value;
            aliases.push(...valueEdges(value, collectionSlot(storage, collectionKey(key, checker, offset, channels)), pathOf));
          }
        }
      }
      if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)) {
        const binding = node.initializer.declarations[0].name;
        const target = ts.isArrayBindingPattern(binding) ? binding.elements[1] : binding;
        const source = pathOf(node.expression);
        if (target && source)
          aliases.push({
            from: source.endsWith('.[*]') ? source : source + '.[*]',
            to: pathOf(ts.isBindingElement(target) ? target.name : target),
            directed: true,
          });
      }
    });
  }
  const firstReads = [...new Set([...aliases.flatMap(({ from, to }) => [from, to]), ...methods.map(({ receiver }) => receiver)])].filter(
    (path) => path.includes('.[first:'),
  );
  for (const read of firstReads) {
    const base = read.slice(0, read.indexOf('.[first:'));
    const slots = aliases.map(({ to }) => to).filter((path) => path.startsWith(base + '.[') && !path.includes('.[first:'));
    const first = slots[0]?.slice(0, slots[0].indexOf(']', base.length) + 1);
    if (first) aliases.push({ from: first, to: read.slice(0, read.indexOf(']', base.length) + 1) });
  }
  propagateAliases(
    [...byPosition.values()],
    aliases.flatMap(({ from, to, directed }) =>
      directed || from.includes('.[*]')
        ? [{ from, to }]
        : [
            { from, to },
            { from: to, to: from },
          ],
    ),
    methods.map((method) => method.receiver),
  );
  for (const method of methods)
    for (const ticket of byPosition.values())
      if ([...ticket.handles].some((handle) => aliasPrefix(handle, method.receiver) === handle))
        (method.name === 'accept' ? ticket.accepts : ticket.invalidates).add(method.receiver);
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

/** @param {ts.CallExpression} node @param {(node: ts.Node) => string} pathOf @returns {{name: string, receiver: string} | null} */
function methodCall(node, pathOf) {
  if (!ts.isPropertyAccessExpression(node.expression) && !ts.isElementAccessExpression(node.expression)) return null;
  const name = ts.isPropertyAccessExpression(node.expression)
    ? node.expression.name.text
    : ts.isStringLiteralLike(node.expression.argumentExpression)
      ? node.expression.argumentExpression.text
      : null;
  if (name !== 'accept' && name !== 'invalidate') return null;
  return { name, receiver: pathOf(node.expression.expression) };
}

/** @param {ts.Node} node @param {(node: ts.Node) => string} pathOf @returns {{from: string, to: string}[]} */
function aliasEdges(node, pathOf) {
  const pair =
    ts.isVariableDeclaration(node) && node.initializer
      ? [node.name, node.initializer]
      : ts.isBinaryExpression(node) && isAssignment(node.operatorToken.kind)
        ? [node.left, node.right]
        : null;
  if (!pair) return [];
  const [target, value] = pair;
  return valueEdges(value, pathOf(target), pathOf);
}

/** @param {ts.Node} value @param {string} to @param {(node: ts.Node) => string} pathOf @returns {{from: string, to: string}[]} */
function valueEdges(value, to, pathOf) {
  if (ts.isConditionalExpression(value)) return [...valueEdges(value.whenTrue, to, pathOf), ...valueEdges(value.whenFalse, to, pathOf)];
  if (
    ts.isBinaryExpression(value) &&
    [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.EqualsToken].includes(value.operatorToken.kind)
  )
    return [...valueEdges(value.left, to, pathOf), ...valueEdges(value.right, to, pathOf)];
  const from = pathOf(value);
  return to ? [...(from ? [{ from, to }] : []), ...objectEdges(value, [to], pathOf)] : [];
}

/** @param {ts.Node} value @param {string[]} targets @param {(node: ts.Node) => string} pathOf @returns {{from: string, to: string}[]} */
function objectEdges(value, targets, pathOf) {
  if (!ts.isObjectLiteralExpression(value)) return [];
  const edges = [];
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
    const name = propertyName(property.name);
    const source = ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer;
    const from = pathOf(source);
    if (!name || !from) continue;
    for (const target of targets) edges.push({ from, to: `${target}.${name}` });
  }
  return edges;
}

/** @param {ts.Node} node @param {(node: ts.Node) => string} pathOf @returns {string[]} */
function assignmentHandles(node, pathOf) {
  const handles = [];
  let current = node;
  while (current.parent) {
    const parent = current.parent;
    if (ts.isBinaryExpression(parent) && parent.right === current && isAssignment(parent.operatorToken.kind)) {
      const target = pathOf(parent.left);
      if (target) handles.push(target);
      current = parent;
      continue;
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
      const target = pathOf(parent.name);
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

/** @param {ReadonlyArray<ReadTicketLifecycle>} tickets @param {{from: string, to: string}[]} aliases @param {string[]} receivers */
function propagateAliases(tickets, aliases, receivers) {
  const handles = [...receivers, ...tickets.flatMap((ticket) => [...ticket.handles])];
  const paths = [...handles, ...aliases.flatMap(({ from, to }) => [from, to])];
  const suffixes = new Set(paths.flatMap((path) => [...path.matchAll(/\./g)].map((match) => path.slice(match.index))));
  const relevant = new Set(paths.flatMap((path) => [path, ...[...path.matchAll(/\./g)].map((match) => path.slice(0, match.index))]));
  for (const ticket of tickets) {
    const pending = [...ticket.handles];
    while (pending.length) {
      const handle = pending.shift();
      if (!handle) continue;
      for (const { from, to } of aliases) {
        const matched = aliasPrefix(handle, from);
        if (matched === undefined) continue;
        const candidate = to + handle.slice(matched.length);
        const reachable =
          relevant.has(candidate) ||
          [...suffixes].some((suffix) => candidate.endsWith(suffix) && relevant.has(candidate.slice(0, -suffix.length)));
        if (!reachable || ticket.handles.has(candidate)) continue;
        ticket.handles.add(candidate);
        pending.push(candidate);
      }
    }
  }
}

/** @param {string} handle @param {string} from @returns {string | undefined} */
function aliasPrefix(handle, from) {
  if (!from.includes('.[*]')) return handle === from || handle.startsWith(from + '.') ? from : undefined;
  const segments = from.split('.[*]').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp('^' + segments.join('\\.\\[[^\\]]+\\]') + '(?=\\.|$)').exec(handle)?.[0];
}

/** @typedef {{path: string, key: number, argument?: number, keys?: boolean}} CollectionChannel */

/** @param {ts.Node} node @param {ts.TypeChecker} checker @param {number} offset @param {Map<string, CollectionChannel>} [channels] @returns {string} */
function expressionPath(node, checker, offset, channels = new Map()) {
  if (ts.isArrayLiteralExpression(node) && node.elements.length === 1 && ts.isSpreadElement(node.elements[0]))
    return expressionPath(node.elements[0].expression, checker, offset, channels);
  if (ts.isIdentifier(node)) {
    const symbol = ts.isShorthandPropertyAssignment(node.parent)
      ? checker.getShorthandAssignmentValueSymbol(node.parent)
      : checker.getSymbolAtLocation(node);
    const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
    return declaration ? `${offset + declaration.getStart()}#${node.text}` : '';
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const channel = channels.get(expressionPath(node.expression, checker, offset, channels));
    if (channel && channel.argument === undefined)
      return channel.keys
        ? channel.path + '.[keys]'
        : collectionSlot(channel.path, collectionKey(node.arguments[channel.key], checker, offset, channels));
    const name = node.expression.name.text;
    if (!['get', 'values', 'entries', 'next', 'keys'].includes(name)) return '';
    const base = expressionPath(node.expression.expression, checker, offset, channels);
    if (name === 'next') return base.replace(/\.\[\*\]$/, `.[first:${offset + node.getStart()}]`);
    if (!base) return '';
    return name === 'get'
      ? collectionSlot(base, collectionKey(node.arguments[0], checker, offset, channels))
      : base + (name === 'keys' ? '.[keys]' : '.[*]');
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node))
    return expressionPath(node.expression, checker, offset, channels);
  if (ts.isPropertyAccessExpression(node)) {
    const base = expressionPath(node.expression, checker, offset, channels);
    if (
      node.name.text === 'value' &&
      ts.isCallExpression(node.expression) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === 'next'
    )
      return base;
    return base ? `${base}.${node.name.text}` : '';
  }
  if (ts.isElementAccessExpression(node)) {
    const base = expressionPath(node.expression, checker, offset, channels);
    return base
      ? ts.isStringLiteralLike(node.argumentExpression)
        ? `${base}.${node.argumentExpression.text}`
        : `${base}.[${collectionKey(node.argumentExpression, checker, offset, channels)}]`
      : '';
  }
  return '';
}

/** @param {ts.SourceFile} ast @param {ts.TypeChecker} checker @param {number} offset @param {import('./context.mjs').ArchitectureFile} file @param {ReadonlyMap<string, import('./context.mjs').ArchitectureFile>} files */
function collectionChannels(ast, checker, offset, file, files) {
  /** @type {Map<string, CollectionChannel>} */
  const channels = new Map();
  /** @type {Map<ts.SourceFile, ts.TypeChecker>} */
  const checkers = new Map();
  visit(ast, (node) => {
    if (
      !ts.isVariableDeclaration(node) ||
      !node.initializer ||
      !ts.isCallExpression(node.initializer) ||
      !ts.isIdentifier(node.initializer.expression)
    )
      return;
    const imported = checker.getSymbolAtLocation(node.initializer.expression)?.declarations?.[0];
    if (!imported || !ts.isImportSpecifier(imported)) return;
    const binding = file.referenceBindings.get(node.initializer.expression.text);
    const provider = binding && files.get(binding.edge.resolved);
    if (!provider) return;
    const root = expressionPath(node.name, checker, offset);
    for (const { ast: source } of provider.syntax.scripts) {
      const factory = source.statements.find(
        (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === binding.binding.importedName,
      );
      if (!factory || !ts.isFunctionDeclaration(factory) || !factory.body) continue;
      for (const statement of factory.body.statements) {
        if (!ts.isReturnStatement(statement) || !statement.expression || !ts.isObjectLiteralExpression(statement.expression)) continue;
        for (const method of statement.expression.properties) {
          if (!ts.isMethodDeclaration(method) || !method.body) continue;
          visit(method.body, (call) => {
            if (
              !ts.isCallExpression(call) ||
              !ts.isPropertyAccessExpression(call.expression) ||
              !ts.isIdentifier(call.expression.expression)
            )
              return;
            const name = call.expression.name.text;
            if (!['get', 'set', 'keys'].includes(name)) return;
            if (!checkers.has(source)) checkers.set(source, sourceChecker(source));
            const providerChecker = /** @type {ts.TypeChecker} */ (checkers.get(source));
            const receiver = call.expression.expression;
            const storage = providerChecker.getSymbolAtLocation(receiver)?.valueDeclaration;
            if (
              !storage ||
              !ts.isVariableDeclaration(storage) ||
              !storage.initializer ||
              !ts.isNewExpression(storage.initializer) ||
              storage.initializer.expression.getText() !== 'Map'
            )
              return;
            const value = call.arguments[1];
            const parameter = value ? providerChecker.getSymbolAtLocation(value)?.valueDeclaration : undefined;
            const argument = name === 'set' ? method.parameters.findIndex((candidate) => candidate === parameter) : undefined;
            const keyParameter = call.arguments[0] ? providerChecker.getSymbolAtLocation(call.arguments[0])?.valueDeclaration : undefined;
            const key = method.parameters.findIndex((candidate) => candidate === keyParameter);
            if (argument === -1 || (name !== 'set' && !ts.isReturnStatement(call.parent)) || (name !== 'keys' && key < 0)) return;
            channels.set(`${root}.${propertyName(method.name)}`, {
              path: `${root}.@${storage.getStart()}`,
              key,
              keys: name === 'keys',
              ...(argument === undefined ? {} : { argument }),
            });
          });
        }
      }
    }
  });
  return channels;
}

/** @param {ts.Node} node @param {ts.TypeChecker} checker @param {number} offset @param {Map<string, CollectionChannel>} channels @returns {string} */
function collectionKey(node, checker, offset, channels) {
  if (ts.isStringLiteralLike(node) || ts.isNumericLiteral(node))
    return encodeURIComponent(JSON.stringify([ts.isNumericLiteral(node) ? 'number' : 'string', node.text])).replaceAll('.', '%2E');
  if (ts.isIdentifier(node)) {
    const declaration = checker.getSymbolAtLocation(node)?.valueDeclaration;
    if (!declaration) return encodeURIComponent(`global:${node.text}`);
    if (declaration && ts.isVariableDeclaration(declaration)) {
      if (declaration.initializer && declaration.parent.flags & ts.NodeFlags.Const && declaration.initializer !== node)
        return collectionKey(declaration.initializer, checker, offset, channels);
      const loop = declaration.parent.parent;
      if (ts.isForOfStatement(loop)) return `iteration:${expressionPath(loop.expression, checker, offset, channels)}`;
    }
  }
  return encodeURIComponent(expressionPath(node, checker, offset, channels) || `expression:${offset + node.getStart()}`).replaceAll(
    '.',
    '%2E',
  );
}

/** @param {string} storage @param {string} key */
function collectionSlot(storage, key) {
  return key === `iteration:${storage}.[keys]` ? storage + '.[*]' : `${storage}.[${key}]`;
}

/** @param {ts.SourceFile} ast */
function sourceChecker(ast) {
  const options = { noLib: true, noResolve: true, allowJs: true, allowNonTsExtensions: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => (name === ast.fileName ? ast : undefined);
  return ts.createProgram([ast.fileName], options, host).getTypeChecker();
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
  return file.positionAt(offset + node.getStart(ast));
}

/** @param {{line: number, column: number}} position @returns {string} */
function positionKey(position) {
  return `${position.line}:${position.column}`;
}
