import ts from 'typescript';
import { sourceChecker } from '../../shared/frontend-source.mjs';
import { dependencyOrigins } from './imports.mjs';
import { modulePartsFromRel } from './rust-crate-paths.mjs';
import { rustModuleBoundaryContext, rustReferenceTarget } from '../../check-rust-module-boundaries.mjs';

/** @typedef {'read' | 'scan' | 'write' | 'publish' | 'lifecycle'} EffectKind */
/** @typedef {{kind:EffectKind, file:string, line:number, column:number, symbol:string}} Effect */
/** @typedef {{id:string, file:string, name:string, line:number, column:number, edges:Set<string>, direct:Effect[]}} EffectFunction */
/** @typedef {{function:EffectFunction, effect:Effect, chain:EffectFunction[]}} EffectPath */

/** @param {string} symbol @returns {EffectKind | null} */
function externalEffect(symbol) {
  if (/^(?:std|tokio)::fs::read_dir$/.test(symbol) || /^node:fs(?:\/promises)?\.readdir(?:Sync)?$/.test(symbol)) return 'scan';
  if (
    /^(?:std|tokio)::fs::(?:write|remove_|rename|create_dir|copy|set_permissions)/.test(symbol) ||
    /^(?:std|tokio)::fs::File::(?:create|create_new|write|set_len|set_permissions|sync_all|sync_data)/.test(symbol) ||
    /^node:fs(?:\/promises)?\.(?:write|append|unlink|rename|rm|rmdir|mkdir|copy|truncate)/.test(symbol)
  )
    return 'write';
  if (/^(?:std|tokio)::fs::|^node:fs(?:\/promises)?\.|^(?:globalThis\.)?(?:fetch|XMLHttpRequest)$/.test(symbol)) return 'read';
  if (/^@tauri-apps\/api\/event\.(?:emit|emitTo)$/.test(symbol)) return 'publish';
  if (symbol === '@tauri-apps/api/core.invoke') return 'lifecycle';
  if (/^vue\.(?:watch|watchEffect|watchPostEffect|watchSyncEffect)$/.test(symbol)) return 'publish';
  if (/^vue\.(?:onMounted|onUnmounted|onScopeDispose|effectScope)$/.test(symbol)) return 'lifecycle';
  if (/^(?:std::process::(?:exit|Command::)|node:child_process\.|@tauri-apps\/api\/window\.)/.test(symbol)) return 'lifecycle';
  if (/^(?:localStorage|sessionStorage)\.(?:setItem|removeItem|clear)$/.test(symbol)) return 'write';
  if (/^(?:localStorage|sessionStorage)\./.test(symbol)) return 'read';
  return null;
}

/** @param {import('./context.mjs').ArchitectureContext} context @param {ReadonlySet<string>} [roots] @returns {EffectPath[]} */
export function effectPaths(context, roots) {
  const reachable = new Set(roots ?? context.frontend.map((file) => file.rel));
  for (const rel of reachable)
    for (const edge of context.byPath.get(rel)?.dependencies ?? [])
      if (!edge.typeOnly && context.byPath.has(edge.resolved)) reachable.add(edge.resolved);
  const frontend = context.frontend.filter((file) => reachable.has(file.rel));
  /** @type {Map<string,EffectFunction>} */
  const functions = new Map();
  /** @type {Map<ts.Node,EffectFunction>} */
  const declarations = new Map();
  /** @type {Map<string,EffectFunction>} */
  const named = new Map();
  /** @type {Array<{file:import('./context.mjs').ArchitectureFile,ast:ts.SourceFile,offset:number}>} */
  const blocks = [];
  /** @param {string} file @param {string} name @param {{line:number,column:number}} position */
  function add(file, name, position) {
    const value = {
      id: file + '#' + position.line + ':' + position.column + '#' + name,
      file,
      name,
      ...position,
      edges: new Set(),
      direct: [],
    };
    functions.set(value.id, value);
    named.set(file + '#' + name, value);
    return value;
  }
  for (const file of frontend) {
    add(file.rel, '<module>', { line: 1, column: 1 });
    for (const { ast, offset } of file.syntax.scripts) {
      blocks.push({ file, ast, offset });
      /** @param {ts.Node} node */
      function visit(node) {
        if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node)) {
          const parent = node.parent;
          const name = node.name?.getText(ast) ?? (ts.isVariableDeclaration(parent) ? parent.name.getText(ast) : '@' + node.getStart(ast));
          const entry = add(file.rel, name, file.positionAt(offset + node.getStart(ast)));
          declarations.set(node, entry);
          if (ts.isVariableDeclaration(parent)) declarations.set(parent, entry);
        }
        ts.forEachChild(node, visit);
      }
      visit(ast);
    }
  }
  for (const file of context.rust) for (const fn of file.rust.functions) add(file.rel, fn.name, fn);
  for (const file of frontend) {
    const initialization = named.get(file.rel + '#<module>');
    for (const edge of file.dependencies) {
      if (edge.typeOnly) continue;
      const target = named.get(edge.resolved + '#<module>');
      if (initialization && target) initialization.edges.add(target.id);
    }
  }
  /** @param {string} rel @param {string} name */
  function exported(rel, name) {
    const file = context.byPath.get(rel);
    const binding = file?.exports.find((entry) => entry.exportedName === name);
    return named.get(rel + '#' + (binding?.localName ?? name));
  }
  for (const { file, ast, offset } of blocks) {
    const checker = sourceChecker(ast);
    /** @param {ts.Node} node @returns {EffectFunction} */
    function owner(node) {
      for (let parent = node.parent; parent; parent = parent.parent) {
        const entry = declarations.get(parent);
        if (entry) return entry;
      }
      return /** @type {EffectFunction} */ (named.get(file.rel + '#<module>'));
    }
    /** @param {ts.Expression} expression @param {Set<ts.Node>} [seen] @returns {{targets:EffectFunction[], external:string[]}} */
    function resolve(expression, seen = new Set()) {
      if (seen.has(expression)) return { targets: [], external: [] };
      seen.add(expression);
      if (
        ts.isParenthesizedExpression(expression) ||
        ts.isAsExpression(expression) ||
        ts.isNonNullExpression(expression) ||
        ts.isAwaitExpression(expression)
      )
        return resolve(expression.expression, seen);
      const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.name : expression);
      const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
      if (declaration && declarations.has(declaration))
        return { targets: [/** @type {EffectFunction} */ (declarations.get(declaration))], external: [] };
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) return resolve(declaration.initializer, seen);
      if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression)) {
        const base = resolve(expression.expression, seen);
        const member = expression.argumentExpression.text;
        return { targets: [], external: base.external.map((symbol) => symbol + '.' + member) };
      }
      let local = null,
        member = null;
      if (ts.isIdentifier(expression)) local = expression.text;
      else if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression)) {
        local = expression.expression.text;
        member = expression.name.text;
      }
      const imported = local && file.referenceBindings.get(local);
      if (imported) {
        if (imported.binding.importedName === '*' && !member && !context.byPath.has(imported.edge.resolved))
          return { targets: [], external: [imported.edge.resolved] };
        const binding = { ...imported.binding, importedName: member ?? imported.binding.importedName };
        const origins = dependencyOrigins({ ...imported.edge, bindings: [binding] }, context.byPath, () => false);
        return {
          targets: origins.flatMap((origin) => {
            const entry = exported(origin.rel, origin.name);
            return entry ? [entry] : [];
          }),
          external: origins.filter((origin) => !context.byPath.has(origin.rel)).map((origin) => origin.rel + '.' + origin.name),
        };
      }
      if (ts.isPropertyAccessExpression(expression)) {
        const receiver = resolve(expression.expression, seen);
        if (receiver.external.length)
          return { targets: [], external: receiver.external.map((symbol) => symbol + '.' + expression.name.text) };
      }
      if (local && !checker.getSymbolAtLocation(ts.isPropertyAccessExpression(expression) ? expression.expression : expression))
        return { targets: [], external: [member ? local + '.' + member : local] };
      return { targets: [], external: [] };
    }
    /** @param {ts.Node} node */
    function visit(node) {
      const caller = owner(node);
      if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isCallExpression(node.parent) && declarations.has(node))
        caller.edges.add(/** @type {EffectFunction} */ (declarations.get(node)).id);
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const resolved = resolve(node.expression);
        for (const target of resolved.targets) caller.edges.add(target.id);
        for (const symbol of resolved.external) {
          const kind = externalEffect(symbol);
          if (kind) caller.direct.push({ kind, file: file.rel, ...file.positionAt(offset + node.getStart(ast)), symbol });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  const rustModules = new Map(context.rust.map((file) => [modulePartsFromRel(file.rel).join('::'), file.rel]));
  const rustContext = rustModuleBoundaryContext(context.rust, context.moduleMap.owners);
  for (const file of context.rust)
    for (const call of file.rust.calls) {
      const fn = file.rust.functions
        .filter((fn) => call.offset > fn.start + fn.signature.length && call.offset < fn.end)
        .sort((a, b) => b.start - a.start)[0];
      if (!fn) continue;
      const caller = functions.get(file.rel + '#' + fn.line + ':' + fn.column + '#' + fn.name);
      if (!caller) continue;
      const origin = rustReferenceTarget(rustContext, file.rel, call.target.split('::'));
      const parts = call.target.split('::'),
        name = parts.pop();
      const rel = origin?.file ?? (parts.length ? rustModules.get(parts.join('::')) : file.rel);
      const target = rel && named.get(rel + '#' + (origin?.name ?? name));
      if (target) caller.edges.add(target.id);
      const kind = externalEffect(call.target);
      if (kind) caller.direct.push({ kind, file: file.rel, line: call.line, column: call.column, symbol: call.target });
    }
  /** @type {EffectPath[]} */
  const paths = [];
  for (const fn of functions.values()) {
    if (roots && !roots.has(fn.file)) continue;
    const pending = [{ node: fn, chain: [fn] }],
      seen = new Set();
    while (pending.length) {
      const current = /** @type {{node:EffectFunction,chain:EffectFunction[]}} */ (pending.shift());
      if (seen.has(current.node.id)) continue;
      seen.add(current.node.id);
      for (const effect of current.node.direct) paths.push({ function: fn, effect, chain: current.chain });
      for (const id of current.node.edges) {
        const next = functions.get(id);
        if (next) pending.push({ node: next, chain: [...current.chain, next] });
      }
    }
  }
  return paths;
}
