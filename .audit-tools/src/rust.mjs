import { Parser, Language } from 'web-tree-sitter';
import { posix, relative } from 'node:path';
import { syntaxPath } from './rust-syntax.mjs';
import { isTextFile } from './collect.mjs';
import { collectRustReferences } from './rust-references.mjs';
import { rustCondition, rustTestOnly } from './rust-conditions.mjs';

/** @param {import('./model.mjs').AuditInputSnapshot} snapshot @param {{target: {name: string, src_path: string}}[]} engines @param {ReadonlyMap<string, string>} owners @param {ReturnType<typeof import('./rust-semantic.mjs').readSemanticIndex>} semantic @param {string[]} [cfg] @returns {Promise<import('./model.mjs').RustFacts>} */
export async function parseRust(snapshot, engines, owners, semantic, cfg = []) {
  await Parser.init();
  const parser = new Parser();
  const language = await Language.load(syntaxPath);
  parser.setLanguage(language);
  /** @type {import('./model.mjs').RustFacts} */
  const result = {
    symbols: [],
    relations: [],
    declarations: [],
    edges: [],
    events: [],
    commands: new Map(),
    moduleParents: [],
    referenceResolutions: [],
    issues: [],
  };
  const files = new Map(
    snapshot.files
      .filter(isTextFile)
      .filter((file) => file.path.endsWith('.rs'))
      .map((file) => [file.path, file]),
  );
  const trees = new Map([...files].map(([path, file]) => [path, /** @type {import('web-tree-sitter').Tree} */ (parser.parse(file.text))]));
  /** @type {{path: string, scope: string, conditional: string}[]} */
  const contexts = [];
  /** @type {Set<string>} */
  const visited = new Set(),
    declarations = new Set(),
    registered = new Set(),
    moduleParents = new Set();
  /** @type {Map<string, import('./model.mjs').Declaration[]>} */
  const commands = new Map();
  /** @param {import('web-tree-sitter').Node} node */
  function attributes(node) {
    const parts = [];
    for (let previous = node.previousNamedSibling; previous?.type === 'attribute_item'; previous = previous.previousNamedSibling)
      parts.unshift(previous.text);
    return parts.join(' ');
  }
  /** @param {import('web-tree-sitter').Node | undefined} node @returns {string | null} */
  function stringValue(node) {
    if (node?.type === 'string_literal') {
      try {
        return JSON.parse(node.text);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        return null;
      }
    }
    if (node?.type === 'raw_string_literal') return node.namedChildren.find((child) => child.type === 'string_content')?.text ?? null;
    return null;
  }
  /** @param {import('web-tree-sitter').Node} node @param {string} path @param {string} scope @param {string} moduleDirectory @param {string} condition */
  function visit(node, path, scope, moduleDirectory, condition = '', pathDirectory = posix.dirname(path)) {
    const attrs = attributes(node),
      conditional = rustCondition(node, condition);
    const testOnly = rustTestOnly(conditional);
    const name = node.childForFieldName('name')?.text;
    const line = node.startPosition.row + 1;
    if (
      name &&
      /^(?:function_item|function_signature_item|struct_item|enum_item|enum_variant|trait_item|type_item|const_item|static_item|mod_item|field_declaration)$/.test(
        node.type,
      )
    ) {
      const nameNode = /** @type {import('web-tree-sitter').Node} */ (node.childForFieldName('name'));
      const declarationTargets =
        semantic.get([path.toLowerCase(), nameNode.startPosition.row + 1, nameNode.startPosition.column + 1].join(':')) ?? [];
      const declaredSymbol = declarationTargets.find((target) => target.symbol)?.symbol ?? null;
      const qualified = scope ? scope + '::' + name : null;
      const declaration = {
        path,
        line,
        column: node.startPosition.column + 1,
        name,
        scope: scope || 'unmapped module',
        qualified: declaredSymbol,
        kind: node.type.replace('_item', '').replace('_declaration', ''),
        text: /** @type {string} */ (node.text.split('\n')[0]).slice(0, 240),
        conditional,
        testOnly,
      };
      if (!declarations.has(path + ':' + line + ':' + name)) {
        result.declarations.push(declaration);
        declarations.add(path + ':' + line + ':' + name);
      }
      if (node.type === 'function_item' && /#\[(?:(?:tauri|command_macros)::)?command\b/.test(attrs)) {
        const entries = commands.get(name) ?? [];
        if (!entries.some((entry) => entry.path === path && entry.line === line)) entries.push(declaration);
        commands.set(name, entries);
      }
      if (node.type === 'mod_item') {
        const body = node.childForFieldName('body');
        if (body) {
          for (const child of body.namedChildren)
            visit(child, path, qualified ?? '', posix.join(moduleDirectory, name), conditional, posix.join(moduleDirectory, name));
        } else if (qualified) {
          const explicit = /#\[path\s*=\s*"([^"]+)"\]/.exec(attrs)?.[1];
          const indexedChildren = [...new Set(declarationTargets.map((target) => target.path).filter((target) => files.has(target)))];
          const candidates = indexedChildren.length
            ? indexedChildren
            : (explicit
                ? [posix.join(pathDirectory, explicit)]
                : [posix.join(moduleDirectory, name + '.rs'), posix.join(moduleDirectory, name, 'mod.rs')]
              )
                .map((entry) => posix.normalize(entry))
                .filter((entry) => files.has(entry));
          if (candidates.length === 1) {
            const child = /** @type {string} */ (candidates[0]);
            const parentKey = [path, child, line, testOnly].join('#');
            if (!moduleParents.has(parentKey)) {
              moduleParents.add(parentKey);
              result.moduleParents.push({ parentPath: path, childPath: child, line, testOnly });
            }
            visitFile(child, qualified, conditional);
          } else
            result.issues.push({
              kind: 'rust-module-location',
              path,
              line,
              parser: 'tree-sitter-rust',
              message: `${qualified}: ${candidates.length} matching source files; ${attrs}`,
            });
        }
        return;
      }
    }
    if (name && ['struct_item', 'enum_item', 'enum_variant', 'trait_item', 'function_item'].includes(node.type)) {
      const body = node.childForFieldName('body');
      if (body) {
        for (const child of body.namedChildren)
          visit(child, path, scope ? scope + '::' + name : '', moduleDirectory, conditional, pathDirectory);
        return;
      }
    }
    if (node.type === 'impl_item') {
      const type = node.childForFieldName('type')?.text;
      const body = node.childForFieldName('body');
      if (body && type) {
        const name = type.replace(/<.*>/, '').split('::').at(-1);
        for (const child of body.namedChildren) visit(child, path, scope ? scope + '::' + name : '', moduleDirectory, conditional);
        return;
      }
    }
    if (node.type === 'macro_invocation') {
      const macro = node.childForFieldName('macro')?.text.split('::').at(-1);
      if (macro === 'generate_handler')
        for (const match of node.text.matchAll(/(?:\w+::)+(\w+)/g))
          if (match[1] !== 'generate_handler') registered.add(JSON.stringify({ name: match[1], path, line, conditional, testOnly }));
      if (macro === 'include_str' || macro === 'include_bytes') {
        const literal = node.descendantsOfType(['string_literal', 'raw_string_literal'])[0];
        const value = stringValue(literal);
        if (value !== null) {
          const target = posix.normalize(posix.join(posix.dirname(path), value));
          if (snapshot.files.some((file) => file.path === target))
            result.edges.push({
              source: path,
              target,
              line,
              symbols: value,
              kind: 'embedded-asset',
              conditional,
              testOnly,
              parser: 'tree-sitter-rust',
            });
          else result.issues.push({ kind: 'embedded-asset', path, line, message: value, parser: 'tree-sitter-rust' });
        }
      }
    }
    if (node.type === 'call_expression') {
      const callable = node.childForFieldName('function');
      if (callable?.type === 'field_expression') {
        const method = callable.childForFieldName('field')?.text;
        if (method === 'emit' || method === 'emit_to') {
          const argument = node.childForFieldName('arguments')?.namedChildren[method === 'emit_to' ? 1 : 0];
          result.events.push({
            path,
            line,
            role: 'emit',
            conditional,
            testOnly,
            value: stringValue(argument),
            expression: argument?.text ?? '',
            parser: 'tree-sitter-rust event method call',
          });
        }
      }
    }
    for (const child of node.namedChildren) visit(child, path, scope, moduleDirectory, conditional, pathDirectory);
  }
  /** @param {string} path @param {string} scope @param {string} [condition] */
  function visitFile(path, scope, condition = '') {
    const key = path + '#' + scope + '#' + condition;
    if (visited.has(key)) return;
    visited.add(key);
    const tree = /** @type {import('web-tree-sitter').Tree} */ (trees.get(path));
    condition = rustCondition(tree.rootNode, condition);
    contexts.push({ path, scope, conditional: condition });
    const base = posix.basename(path, '.rs');
    const moduleDirectory = ['lib', 'main', 'mod'].includes(base) ? posix.dirname(path) : posix.join(posix.dirname(path), base);
    for (const child of tree.rootNode.namedChildren) visit(child, path, scope, moduleDirectory, condition);
  }
  try {
    for (const engine of engines) {
      const source = relative(snapshot.root, engine.target.src_path).replaceAll('\\', '/');
      const crate = engine.target.name.replaceAll('-', '_');
      visitFile(source, crate);
    }
    for (const [path, tree] of trees) {
      if (tree.rootNode.hasError) {
        /** @param {import('web-tree-sitter').Node} node */
        function diagnose(node) {
          if (node.isError || node.isMissing)
            result.issues.push({
              kind: 'parse',
              path,
              line: node.startPosition.row + 1,
              column: node.startPosition.column + 1,
              parser: 'tree-sitter-rust',
              message: 'Rust syntax node ' + node.type + ': ' + node.text.slice(0, 160),
              candidates: [],
            });
          for (const child of node.namedChildren) diagnose(child);
        }
        diagnose(tree.rootNode);
      }
      if (![...visited].some((key) => key.startsWith(path + '#'))) visitFile(path, '');
    }
    for (const [path, file] of files) {
      const assembled = contexts.filter((context) => context.path === path && context.scope);
      if (assembled.length && assembled.every((context) => rustTestOnly(context.conditional))) {
        file.role = 'test';
        file.roleEvidence = assembled.map((context) => ({
          path,
          line: 1,
          text: context.conditional,
          parser: 'Rust module conditions',
        }));
      }
    }
    collectRustReferences(snapshot, trees, contexts, result, owners, semantic, cfg);
    const registrations = [...registered].map((entry) => JSON.parse(entry));
    for (const registration of registrations) {
      const matches = (commands.get(registration.name) ?? []).filter((declaration) => !declaration.testOnly || registration.testOnly);
      const previous = result.commands.get(registration.name) ?? [];
      if (matches.length)
        result.commands.set(registration.name, [
          ...new Map([...previous, ...matches].map((entry) => [entry.path + ':' + entry.line, entry])).values(),
        ]);
      else
        result.issues.push({
          kind: 'ipc-registration',
          path: registration.path,
          line: registration.line,
          conditional: registration.conditional,
          testOnly: registration.testOnly,
          parser: 'tree-sitter-rust',
          message: registration.name + ': registered handler has no parsed command declaration',
        });
    }
    return result;
  } finally {
    for (const tree of trees.values()) tree.delete();
    parser.delete();
  }
}
