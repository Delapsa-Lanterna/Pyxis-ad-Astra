import { rustCondition, rustTestOnly } from './rust-conditions.mjs';
/** @typedef {import('web-tree-sitter').Node} Node */
/** @typedef {ReturnType<typeof import('./rust-semantic.mjs').readSemanticIndex> extends Map<string,infer Value> ? Value : never} Targets */
/** @typedef {{file:string,node:Node,scope:string,alias:string|null,name:string,wildcard:boolean,exported:boolean,targets:Targets,namespace:Targets,conditional:string,testOnly:boolean}} Import */
/** @param {Map<string,import('web-tree-sitter').Tree>} trees @param {(file:string,node:Node)=>Targets} lookup @returns {Import[]} */
export function collectRustImports(trees, lookup) {
  /** @type {Import[]} */
  const imports = [];
  /** @param {Node} node */
  const terminal = (node) => node.childForFieldName('name') ?? node;
  for (const [file, tree] of trees)
    for (const use of tree.rootNode.descendantsOfType('use_declaration')) {
      const chain = [];
      for (let current = /** @type {Node|null} */ (use); current; current = current.parent) chain.unshift(current);
      const scope = chain
        .filter((n) => n.type === 'mod_item')
        .map((n) => n.startIndex)
        .join(':');
      const conditional = chain.reduce((value, item) => rustCondition(item, value), '');
      /** @param {Node} node @param {Node|null} [prefix] */
      function entry(node, prefix = null) {
        if (node.type === 'scoped_use_list') {
          for (const child of node.childForFieldName('list')?.namedChildren ?? []) entry(child, node.childForFieldName('path'));
          return;
        }
        if (node.type === 'use_list') {
          for (const child of node.namedChildren) entry(child, prefix);
          return;
        }
        const path = node.type === 'use_as_clause' ? /** @type {Node} */ (node.childForFieldName('path')) : node;
        const token = path.type === 'use_wildcard' ? terminal(path.namedChildren[0] ?? /** @type {Node} */ (prefix)) : terminal(path);
        const qualifier = path.childForFieldName('path') ?? prefix;
        imports.push({
          file,
          node: use,
          scope,
          alias: node.childForFieldName('alias')?.text ?? null,
          name: token.text,
          wildcard: path.type === 'use_wildcard',
          exported: use.namedChildren.some((c) => c.type === 'visibility_modifier'),
          targets: lookup(file, token),
          namespace: qualifier ? lookup(file, terminal(qualifier)) : [],
          conditional,
          testOnly: rustTestOnly(conditional),
        });
      }
      const argument = use.childForFieldName('argument');
      if (argument) entry(argument);
    }
  return imports;
}
/** Checks project syntax rules against engine-provided targets. @param {Map<string,import('web-tree-sitter').Tree>} trees @param {Import[]} imports @param {(file:string,node:Node)=>Targets} lookup @param {ReadonlyMap<string,string>} owners @param {import('./model.mjs').RustFacts} result */
export function checkRustBoundaries(trees, imports, lookup, owners, result) {
  const technical = new Set([
    'src-tauri/src/commands/mod.rs',
    'src-tauri/src/io/mod.rs',
    'src-tauri/src/models/mod.rs',
    'src-tauri/src/parsers/mod.rs',
  ]);
  /** @param {Import} entry @param {Set<Import>} [seen] @returns {number|null} */
  function depth(entry, seen = new Set()) {
    const target = entry.targets[0],
      namespace = entry.namespace[0];
    if (!target || !namespace) return null;
    if (target.path === namespace.path && target.symbol.startsWith(namespace.symbol + '::')) return 0;
    if (seen.has(entry)) return null;
    const exported = imports.find(
      (other) =>
        other.file === namespace.path &&
        other.exported &&
        (other.alias ?? other.name) === entry.name &&
        other.targets.some((t) => t.path === target.path && t.line === target.line && t.column === target.column),
    );
    if (!exported) return null;
    const next = depth(exported, new Set(seen).add(entry));
    return next === null ? null : next + 1;
  }
  /** @param {string} kind @param {Import} entry @param {string} message */
  function issue(kind, entry, message) {
    result.issues.push({
      kind,
      path: entry.file,
      line: entry.node.startPosition.row + 1,
      column: entry.node.startPosition.column + 1,
      conditional: entry.conditional,
      testOnly: entry.testOnly,
      message,
      parser: 'Rust syntax + rust-analyzer declarations',
      candidates: entry.targets.map((target) => ({
        path: target.path,
        line: target.line,
        column: target.column,
        text: target.symbol,
        parser: 'rust-analyzer LSIF',
      })),
    });
  }
  for (const entry of imports) {
    const own = owners.get(entry.file);
    if (!own || entry.testOnly) continue;
    const crosses = entry.targets.some((target) => owners.has(target.path) && owners.get(target.path) !== own);
    if (!entry.exported || !crosses || technical.has(entry.file)) continue;
    if (entry.wildcard) issue('rust-business-export-glob', entry, 'Wildcard business export: ' + entry.node.text);
    else {
      const layers = depth(entry);
      if (layers === null)
        issue(
          'rust-business-export-coverage',
          entry,
          'Export chain is not established by indexed module and declaration positions: ' + entry.node.text,
        );
      else if (layers > 0)
        issue(
          'rust-business-export-depth',
          entry,
          'Business export passes through ' + layers + ' intermediate exports: ' + entry.node.text,
        );
    }
  }
  for (const [file, tree] of trees) {
    const own = owners.get(file);
    if (!own) continue;
    for (const node of tree.rootNode.descendantsOfType(['type_identifier', 'scoped_type_identifier'])) {
      if (node.parent?.type === 'scoped_type_identifier' || node.parent?.childForFieldName('name')?.id === node.id || node.text === 'Self')
        continue;
      const token = node.childForFieldName('name') ?? node;
      const targets = lookup(file, token);
      if (!targets.some((target) => owners.has(target.path) && owners.get(target.path) !== own)) continue;
      const chain = [];
      for (let current = /** @type {Node|null} */ (node); current; current = current.parent) chain.unshift(current);
      const conditional = chain.reduce((value, item) => rustCondition(item, value), '');
      if (rustTestOnly(conditional)) continue;
      const scopes = chain
        .filter((n) => n.type === 'mod_item')
        .map((n) => n.startIndex)
        .join(':');
      const named =
        node.type === 'type_identifier' &&
        imports.some(
          (entry) =>
            entry.file === file &&
            !entry.wildcard &&
            !entry.alias &&
            entry.name === node.text &&
            (scopes === entry.scope || scopes.startsWith(entry.scope + ':') || entry.scope === '') &&
            entry.targets.some((imported) =>
              targets.some((target) => target.path === imported.path && target.line === imported.line && target.column === imported.column),
            ),
        );
      if (!named)
        result.issues.push({
          kind: 'rust-business-type-import',
          path: file,
          line: node.startPosition.row + 1,
          column: node.startPosition.column + 1,
          conditional,
          testOnly: false,
          message: node.text + ' crosses a business boundary without its declared named import',
          parser: 'Rust syntax + rust-analyzer declarations',
          candidates: targets.map((target) => ({
            path: target.path,
            line: target.line,
            column: target.column,
            text: target.symbol,
            parser: 'rust-analyzer LSIF',
          })),
        });
    }
  }
}
