import { rustCondition, rustTestOnly, rustConditionEnabled } from './rust-conditions.mjs';
import { checkRustBoundaries, collectRustImports } from './rust-rules.mjs';
/** @typedef {import('web-tree-sitter').Node} Node */

/** Records syntax roles while every target comes from the semantic index.
 * @param {import('./model.mjs').AuditInputSnapshot} input
 * @param {Map<string, import('web-tree-sitter').Tree>} trees
 * @param {{path:string,scope:string,conditional:string}[]} contexts
 * @param {import('./model.mjs').RustFacts} result
 * @param {ReadonlyMap<string,string>} owners
 * @param {ReturnType<typeof import('./rust-semantic.mjs').readSemanticIndex>} index
 * @param {string[]} cfg */
export function collectRustReferences(input, trees, contexts, result, owners, index, cfg) {
  const files = new Map(input.files.map((file) => [file.path.toLowerCase(), file]));
  /** @param {string} file @param {Node} node */
  const lookup = (file, node) => index.get([file.toLowerCase(), node.startPosition.row + 1, node.startPosition.column + 1].join(':')) ?? [];
  const imports = collectRustImports(trees, lookup);
  /** @param {Node} node */
  function ancestors(node) {
    const chain = [];
    for (let current = /** @type {Node|null} */ (node); current; current = current.parent) chain.unshift(current);
    return chain;
  }
  /** @param {Node} node */
  function called(node) {
    let value = node;
    while (['generic_function', 'parenthesized_expression'].includes(value.parent?.type ?? '')) value = /** @type {Node} */ (value.parent);
    return value.parent?.type === 'call_expression' && value.parent.childForFieldName('function')?.id === value.id;
  }
  /** @param {string} file @param {Node} node */
  function enclosing(file, node) {
    for (let current = /** @type {Node|null} */ (node.parent); current; current = current.parent)
      if (['function_item', 'const_item', 'static_item', 'struct_item', 'enum_item', 'trait_item', 'mod_item'].includes(current.type)) {
        const name = current.childForFieldName('name');
        if (name) {
          const value = lookup(file, name).find((target) => target.symbol);
          if (value) return value.symbol;
        }
      }
    return index.get(file.toLowerCase() + ':1:1')?.find((target) => target.symbol)?.symbol ?? '';
  }
  const emitted = new Set();
  for (const [key, targets] of index) {
    const match = /^(.*):(\d+):(\d+)$/.exec(key),
      file = files.get(match?.[1] ?? '');
    if (!file || !targets.length) continue;
    const tree = trees.get(file.path);
    if (!tree) continue;
    const line = Number(/** @type {RegExpExecArray} */ (match)[2]),
      column = Number(/** @type {RegExpExecArray} */ (match)[3]);
    const node = tree.rootNode.namedDescendantForPosition({ row: line - 1, column: column - 1 });
    if (!node) continue;
    const chain = ancestors(node),
      types = chain.map((item) => item.type);
    const context =
      contexts.find((item) => item.path === file.path && !rustTestOnly(item.conditional)) ??
      contexts.find((item) => item.path === file.path);
    const conditional = chain.reduce((value, item) => rustCondition(item, value), context?.conditional ?? '');
    const testOnly = file.role === 'test' || rustTestOnly(conditional);
    const role = types.includes('use_declaration')
      ? 'import'
      : types.includes('visibility_modifier')
        ? 'visibility'
        : node.parent?.type === 'mod_item'
          ? 'module'
          : types.includes('line_comment') || types.includes('block_comment')
            ? 'documentation'
            : types.includes('attribute_item') || types.includes('inner_attribute_item')
              ? 'attribute'
              : 'usage';
    const field = node.parent?.type === 'field_expression' && node.parent.childForFieldName('field')?.id === node.id;
    const call = field ? called(/** @type {Node} */ (node.parent)) : called(node);
    const type =
      /type/.test(node.type) ||
      types.some((t) =>
        ['generic_type', 'reference_type', 'type_arguments', 'trait_bounds', 'type_parameter', 'where_predicate'].includes(t),
      );
    let kind =
      role === 'import'
        ? types.includes('use_declaration') &&
          chain.find((n) => n.type === 'use_declaration')?.namedChildren.some((c) => c.type === 'visibility_modifier')
          ? 'rust-reexport'
          : 'rust-import'
        : role === 'visibility'
          ? 'rust-visibility'
          : role === 'module'
            ? 'rust-module'
            : role === 'documentation'
              ? 'rust-documentation'
              : field
                ? call
                  ? 'rust-method'
                  : 'rust-field'
                : call
                  ? 'rust-call'
                  : type
                    ? 'rust-type'
                    : 'rust-value';
    const scope = enclosing(file.path, node);
    const evidence = { path: file.path, line, column, text: node.text, parser: 'tree-sitter-rust syntax role' };
    const internal = targets.filter((target) => files.has(target.path.toLowerCase()));
    /** @type {import('./model.mjs').RustFacts['referenceResolutions'][number]} */
    const reference = {
      space: kind === 'rust-type' ? 'type' : 'value',
      kind,
      path: file.path,
      line,
      column,
      scope,
      conditional,
      testOnly,
      name: node.text,
      route: 'semantic',
      reason: internal.length ? 'project-declaration' : 'external-declaration',
      targets: targets.map((target) => ({
        path: files.get(target.path.toLowerCase())?.path ?? target.path,
        line: target.line,
        column: target.column,
        text: target.symbol,
        parser: 'rust-analyzer LSIF',
      })),
    };
    for (const target of internal) {
      const destination = /** @type {import('./model.mjs').File} */ (files.get(target.path.toLowerCase()));
      const targetTree = trees.get(destination.path),
        targetNode = targetTree?.rootNode.namedDescendantForPosition({ row: target.line - 1, column: target.column - 1 });
      const wholeFile =
        targetTree &&
        target.line === 1 &&
        target.column === 1 &&
        target.endLine === targetTree.rootNode.endPosition.row + 1 &&
        target.endColumn === targetTree.rootNode.endPosition.column + 1;
      const moduleTarget = wholeFile || targetNode?.parent?.type === 'mod_item';
      const targetAncestors = targetNode ? ancestors(targetNode) : [];
      const fieldTarget = targetAncestors.some((n) => n.type === 'field_declaration');
      if (field && call && fieldTarget) {
        reference.kind = 'rust-field-call';
        reference.reason = 'callable-field-contract';
      }
      const edgeKind = moduleTarget ? 'rust-module' : fieldTarget ? 'rust-field' : kind === 'rust-method' ? 'rust-call' : kind;
      const id = [file.path, line, column, destination.path, target.line, target.column, edgeKind].join(':');
      if (emitted.has(id)) continue;
      emitted.add(id);
      result.edges.push({
        source: file.path,
        target: destination.path,
        line,
        column,
        targetLine: target.line,
        targetColumn: target.column,
        symbols: node.text + ' → ' + target.symbol,
        kind: edgeKind,
        dependencyClass: moduleTarget || ['import', 'visibility', 'module', 'documentation'].includes(role) ? 'structure' : 'usage',
        sourceSymbol: scope,
        targetSymbol: target.symbol,
        positionKind: 'reference',
        parser: 'rust-analyzer LSIF',
        conditional,
        testOnly,
        evidence: [
          evidence,
          {
            path: destination.path,
            line: target.line,
            column: target.column,
            text: 'Semantic declaration or expansion origin: ' + target.symbol + '; package ' + target.package,
            parser: 'rust-analyzer LSIF',
          },
        ],
      });
    }
    result.referenceResolutions.push(reference);
  }
  for (const [file, tree] of trees) {
    const context =
      contexts.find((item) => item.path === file && !rustTestOnly(item.conditional)) ?? contexts.find((item) => item.path === file);
    for (const node of tree.rootNode.descendantsOfType(['type_identifier', 'identifier', 'field_identifier'])) {
      if (
        node.text === '_' ||
        (['scoped_identifier', 'scoped_type_identifier'].includes(node.parent?.type ?? '') &&
          node.parent?.childForFieldName('path')?.id === node.id)
      )
        continue;
      const chain = ancestors(node);
      if (
        chain.some((n) =>
          ['lifetime', 'attribute_item', 'inner_attribute_item', 'token_tree', 'line_comment', 'block_comment'].includes(n.type),
        )
      )
        continue;
      if (
        (node.parent?.childForFieldName('name')?.id === node.id &&
          !['scoped_identifier', 'scoped_type_identifier'].includes(node.parent.type)) ||
        node.parent?.childForFieldName('pattern')?.id === node.id
      )
        continue;
      if (lookup(file, node).length) continue;
      const conditional = chain.reduce((value, item) => rustCondition(item, value), context?.conditional ?? '');
      result.issues.push({
        kind: rustConditionEnabled(conditional, cfg) === false ? 'rust-inactive-source' : 'rust-semantic-coverage',
        path: file,
        line: node.startPosition.row + 1,
        column: node.startPosition.column + 1,
        conditional,
        testOnly: files.get(file.toLowerCase())?.role === 'test' || rustTestOnly(conditional),
        message:
          (rustConditionEnabled(conditional, cfg) === false ? 'Excluded by compiler configuration: ' : 'No semantic declaration: ') +
          node.text,
        parser: 'rust-analyzer LSIF',
      });
    }
  }
  checkRustBoundaries(trees, imports, lookup, owners, result);
  const symbols = new Map();
  for (const targets of index.values())
    for (const target of targets)
      if (target.symbol && files.has(target.path.toLowerCase())) {
        const value = symbols.get(target.symbol) ?? { id: target.symbol, label: target.symbol, kind: 'semantic', locations: [] };
        if (
          !value.locations.some(
            (/** @type {{path:string,line:number}} */ location) => location.path === target.path && location.line === target.line,
          )
        )
          value.locations.push({ path: target.path, line: target.line });
        symbols.set(target.symbol, value);
      }
  result.symbols = [...symbols.values()];
  result.relations = result.edges
    .filter((edge) => edge.sourceSymbol && edge.targetSymbol)
    .map((edge) => ({
      source: /** @type {string} */ (edge.sourceSymbol),
      target: /** @type {string} */ (edge.targetSymbol),
      kind: edge.dependencyClass ?? 'usage',
    }));
}
