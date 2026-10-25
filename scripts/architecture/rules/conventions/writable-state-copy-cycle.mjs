import ts from 'typescript';
import { defineRule } from '../../diagnostics.mjs';

/** @typedef {{root: ts.CallExpression, path: string[], ref: boolean, unwrapped: boolean}} Slot */
/** @typedef {{from: Slot, to: Slot, write: ts.Node, excluded: string[]}} Copy */
/** @typedef {{index: number, low: number, pending: boolean}} Vertex */

const stateFactories = new Set(['ref', 'shallowRef', 'reactive', 'shallowReactive']);

export const writableStateCopyCycleRule = defineRule(
  'writable-state-copy-cycle',
  '.zcode/frontend-guidelines.md#状态与模块',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      const imported = file.imports.filter((binding) => !binding.typeOnly && binding.specifier === 'vue');
      const creations = file.calls.filter(
        (call) =>
          !call.factory &&
          imported.some(
            (binding) =>
              binding.localName === call.localName &&
              stateFactories.has(binding.importedName === '*' ? (call.member ?? '') : (binding.importedName ?? '')),
          ),
      );
      if (creations.length < 2) continue;
      for (const { ast, offset } of file.syntax.scripts) {
        /** @type {Map<ts.Node, Map<string, ts.Node>>} */
        const bindings = new Map();
        /** @type {ts.VariableDeclaration[]} */
        const variables = [];
        /** @type {ts.BinaryExpression[]} */
        const writes = [];
        /** @type {ts.CallExpression[]} */
        const calls = [];
        /** @type {Map<ts.Node, ts.Node>} */
        const owners = new Map();
        /** @param {ts.Node} node @returns {ts.Node} */
        function scope(node) {
          let parent = node.parent;
          while (
            parent &&
            !ts.isSourceFile(parent) &&
            !ts.isBlock(parent) &&
            !ts.isFunctionLike(parent) &&
            !ts.isForStatement(parent) &&
            !ts.isForOfStatement(parent) &&
            !ts.isCatchClause(parent)
          )
            parent = parent.parent;
          return parent ?? ast;
        }
        /** @param {ts.Node} node @param {ts.Node} owner */
        function collect(node, owner) {
          owners.set(node, owner);
          if (
            (ts.isVariableDeclaration(node) ||
              ts.isParameter(node) ||
              ts.isFunctionDeclaration(node) ||
              ts.isImportSpecifier(node) ||
              ts.isNamespaceImport(node)) &&
            node.name &&
            ts.isIdentifier(node.name)
          ) {
            const container = scope(node),
              names = bindings.get(container) ?? new Map();
            names.set(node.name.getText(), node);
            bindings.set(container, names);
          }
          if (ts.isVariableDeclaration(node)) variables.push(node);
          if (ts.isCallExpression(node)) calls.push(node);
          if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) writes.push(node);
          ts.forEachChild(node, (child) => collect(child, ts.isFunctionLike(node) ? node : owner));
        }
        collect(ast, ast);
        /** @param {ts.Node} node @returns {ts.Node | undefined} */
        function local(node) {
          let container = scope(node);
          while (true) {
            const declaration = bindings.get(container)?.get(node.getText());
            if (declaration) return declaration;
            if (ts.isSourceFile(container)) return;
            container = scope(container);
          }
        }
        /** @param {ts.Node} node @param {Set<ts.Node>} [seen] @returns {ts.Node} */
        function definition(node, seen = new Set()) {
          if (seen.has(node)) return node;
          seen.add(node);
          if (ts.isIdentifier(node)) {
            const declaration = local(node);
            if (declaration) return definition(declaration, seen);
          }
          if (ts.isVariableDeclaration(node) && node.initializer && node.parent.flags & ts.NodeFlags.Const)
            return definition(node.initializer, seen);
          return node;
        }
        /** @param {ts.Node} node @returns {{module: string, name: string} | undefined} */
        function origin(node) {
          node = definition(node);
          if (ts.isImportSpecifier(node) || ts.isNamespaceImport(node)) {
            const binding = file.referenceBindings.get(node.name.getText());
            if (binding) return { module: binding.edge.resolved, name: binding.binding.importedName ?? '*' };
          }
          if (ts.isPropertyAccessExpression(node)) {
            const namespace = definition(node.expression);
            if (ts.isNamespaceImport(namespace)) {
              const binding = file.referenceBindings.get(namespace.name.getText());
              if (binding) return { module: binding.edge.resolved, name: node.name.getText() };
            }
          }
        }
        /** @param {ts.Node} node */
        function factory(node) {
          if (!ts.isCallExpression(node)) return;
          const source = origin(node.expression);
          return source?.module === 'vue' && stateFactories.has(source.name) ? source.name : undefined;
        }
        /** @type {Map<ts.Node, Slot | null>} */
        const resolved = new Map();
        /** @param {ts.Node} node @returns {Slot | null} */
        function slot(node) {
          if (resolved.has(node)) return resolved.get(node) ?? null;
          resolved.set(node, null);
          const result = resolveSlot(node);
          resolved.set(node, result);
          return result;
        }
        /** @param {ts.Node} node @returns {Slot | null} */
        function resolveSlot(node) {
          if (
            ts.isParenthesizedExpression(node) ||
            ts.isAsExpression(node) ||
            ts.isNonNullExpression(node) ||
            ts.isSatisfiesExpression(node)
          )
            return slot(node.expression);
          if (ts.isIdentifier(node)) {
            const declaration = local(node);
            return declaration &&
              ts.isVariableDeclaration(declaration) &&
              declaration.initializer &&
              declaration.parent.flags & ts.NodeFlags.Const
              ? slot(declaration.initializer)
              : null;
          }
          if (ts.isCallExpression(node)) {
            const kind = factory(node);
            if (!kind) return null;
            const existing = node.arguments[0] ? slot(node.arguments[0]) : null;
            const ref = kind === 'ref' || kind === 'shallowRef';
            if (existing && (!ref || (existing.ref && !existing.unwrapped))) return existing;
            return ts.isVariableDeclaration(node.parent) ? { root: node, path: [], ref, unwrapped: false } : null;
          }
          if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
            const parent = slot(node.expression);
            const name = ts.isPropertyAccessExpression(node)
              ? node.name.getText()
              : ts.isStringLiteralLike(node.argumentExpression) || ts.isNumericLiteral(node.argumentExpression)
                ? node.argumentExpression.getText().replace(/^['"]|['"]$/g, '')
                : null;
            if (!parent || name === null) return null;
            return {
              ...parent,
              path: parent.ref && !parent.unwrapped && name === 'value' ? parent.path : [...parent.path, name],
              unwrapped: true,
            };
          }
          return null;
        }
        /** @param {Slot} item */
        const key = (item) => item.root.pos + ':' + JSON.stringify(item.path);
        /** @type {Copy[]} */
        const copies = [];
        /** @param {Slot} to @param {ts.Node} expression @param {ts.Node} write */
        function transfer(to, expression, write) {
          const from = slot(expression);
          if (from) {
            if (key(from) !== key(to)) copies.push({ from, to, write, excluded: [] });
          } else if (ts.isObjectLiteralExpression(expression)) {
            const overridden = new Set();
            for (const property of [...expression.properties].reverse()) {
              if (ts.isSpreadAssignment(property)) {
                const source = slot(property.expression);
                if (source) copies.push({ from: source, to, write, excluded: [...overridden] });
              } else if (property.name && !ts.isComputedPropertyName(property.name)) {
                const name = property.name.getText().replace(/^['"]|['"]$/g, '');
                if (overridden.has(name)) continue;
                overridden.add(name);
                if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property))
                  transfer(
                    { ...to, path: [...to.path, name] },
                    ts.isPropertyAssignment(property) ? property.initializer : property.name,
                    write,
                  );
              }
            }
          }
        }
        for (const variable of variables) {
          if (!variable.initializer || !ts.isCallExpression(variable.initializer) || !factory(variable.initializer)) continue;
          const target = slot(variable.initializer);
          if (target?.root === variable.initializer && variable.initializer.arguments[0])
            transfer(target, variable.initializer.arguments[0], variable.initializer);
        }
        for (const write of writes) {
          if (ts.isIdentifier(write.left)) continue;
          const target = slot(write.left);
          if (target) transfer(target, write.right, write);
        }
        if (!copies.length) continue;
        const contracts = calls.filter((call) => {
          const source = origin(call.expression);
          return source?.module === 'src/shared/runtime/field-inputs.ts' && source.name === 'registerFieldInput';
        });
        /** @param {ts.Node} action @param {ts.Node} owner @param {Set<ts.Node>} [seen] @returns {boolean} */
        function reaches(action, owner, seen = new Set()) {
          action = definition(action);
          if (action === owner) return true;
          if (seen.has(action)) return false;
          seen.add(action);
          return calls.some((call) => owners.get(call) === action && reaches(call.expression, owner, seen));
        }
        /** @param {Copy[]} edges */
        function inputLifecycle(edges) {
          for (const contract of contracts) {
            const input = contract.arguments[0] && definition(contract.arguments[0]);
            if (!input || !ts.isObjectLiteralExpression(input)) continue;
            const fields = new Map(
              input.properties.flatMap((property) =>
                ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)
                  ? [[property.name.getText(), ts.isPropertyAssignment(property) ? property.initializer : property.name]]
                  : [],
              ),
            );
            const dirtyField = fields.get('dirty');
            const dirty = dirtyField && definition(dirtyField);
            const commit = fields.get('commit'),
              cancel = fields.get('cancel');
            if (!dirty || !ts.isCallExpression(dirty) || !commit || !cancel) continue;
            const source = origin(dirty.expression);
            if (source?.module !== 'vue' || source.name !== 'computed' || !dirty.arguments[0]) continue;
            /** @type {string[][]} */
            const pairs = [];
            function compare(/** @type {ts.Node} */ node) {
              if (
                ts.isBinaryExpression(node) &&
                [ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)
              ) {
                const left = slot(node.left),
                  right = slot(node.right);
                if (left && right) pairs.push([key(left), key(right)]);
              }
              ts.forEachChild(node, compare);
            }
            compare(definition(dirty.arguments[0]));
            for (const [draft, base] of pairs) {
              if (!edges.every((edge) => [draft, base].includes(key(edge.from)) && [draft, base].includes(key(edge.to)))) continue;
              const committed = (/** @type {Copy} */ edge) =>
                key(edge.to) === base && reaches(commit, /** @type {ts.Node} */ (owners.get(edge.write)));
              const cancelled = (/** @type {Copy} */ edge) => reaches(cancel, /** @type {ts.Node} */ (owners.get(edge.write)));
              const initialized = (/** @type {Copy} */ edge) => edge.write === edge.to.root && key(edge.to) === base;
              const reset = (/** @type {Copy} */ edge) =>
                writes.some((write) => {
                  const target = slot(write.left);
                  return (
                    owners.get(write) === owners.get(edge.write) &&
                    write.pos < edge.write.pos &&
                    target &&
                    key(target) === key(edge.from) &&
                    !slot(write.right)
                  );
                });
              if (
                edges.some(committed) &&
                edges.some((edge) => key(edge.to) === draft && cancelled(edge)) &&
                edges.every((edge) => committed(edge) || cancelled(edge) || initialized(edge) || reset(edge))
              )
                return true;
            }
          }
          return false;
        }
        const slots = new Map(
          copies.flatMap((edge) => [
            [key(edge.from), edge.from],
            [key(edge.to), edge.to],
          ]),
        );
        const observed = new Set(slots.keys());
        const members = new Set([...slots.values()].flatMap((item) => item.path.map((_, index) => JSON.stringify(item.path.slice(index)))));
        const suffixes = [[], ...[...members].map((path) => JSON.parse(path))];
        /** @type {Map<string, Copy[]>} */
        const graph = new Map();
        for (const copy of copies)
          for (const suffix of suffixes) {
            if (copy.excluded.length && (!suffix.length || copy.excluded.includes(suffix[0]))) continue;
            const from = { ...copy.from, path: [...copy.from.path, ...suffix] },
              to = { ...copy.to, path: [...copy.to.path, ...suffix] };
            if (key(from) === key(to)) continue;
            slots.set(key(from), from);
            slots.set(key(to), to);
            const outgoing = graph.get(key(from)) ?? [];
            outgoing.push({ ...copy, from, to });
            graph.set(key(from), outgoing);
          }
        /** @type {Map<string, Vertex>} */
        const vertices = new Map();
        /** @type {string[]} */
        const stack = [];
        /** @param {ts.Node} node */
        const position = (node) => file.positionAt(offset + node.getStart(ast));
        /** @param {ts.Node} node */
        const label = (node) => {
          const at = position(node);
          return `${file.rel}:${at.line}:${at.column}`;
        };
        /** @param {string} current */
        function component(current) {
          const vertex = { index: vertices.size, low: vertices.size, pending: true };
          vertices.set(current, vertex);
          stack.push(current);
          for (const edge of graph.get(current) ?? []) {
            const target = key(edge.to),
              visited = vertices.get(target);
            if (!visited) {
              component(target);
              vertex.low = Math.min(vertex.low, /** @type {Vertex} */ (vertices.get(target)).low);
            } else if (visited.pending) vertex.low = Math.min(vertex.low, visited.index);
          }
          if (vertex.low !== vertex.index) return;
          const group = new Set();
          let next;
          do {
            next = /** @type {string} */ (stack.pop());
            /** @type {Vertex} */ (vertices.get(next)).pending = false;
            group.add(next);
          } while (next !== current);
          if (group.size < 2 || ![...group].some((item) => observed.has(item))) return;
          const edges = [...group].flatMap((item) => graph.get(item) ?? []).filter((edge) => group.has(key(edge.to)));
          if (inputLifecycle(edges)) return;
          const at = /** @type {Slot} */ (slots.get(current));
          const describe = (/** @type {Slot} */ item) => label(item.root) + (item.path.length ? ' [' + item.path.join('.') + ']' : '');
          report(
            file,
            position(at.root),
            'writable state copy cycle: ' +
              edges.map((edge) => `${describe(edge.from)} -> ${label(edge.write)} -> ${describe(edge.to)}`).join('; '),
            { target: label(at.root), expected: 'one writable owner with derived consumers' },
          );
        }
        for (const current of slots.keys()) if (!vertices.has(current)) component(current);
      }
    }
  },
);
