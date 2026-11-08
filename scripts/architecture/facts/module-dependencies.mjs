import { dependencyOrigins } from './imports.mjs';
import { rustModuleBoundaryContext, rustImportDependencies } from '../../check-rust-module-boundaries.mjs';

/** @typedef {{source:string,target:string,file:string,resolved:string,line:number,column:number,symbol:string}} ModuleDependency */
/** @param {import('./context.mjs').ArchitectureContext} context @returns {ModuleDependency[]} */
export function moduleDependencyEdges(context) {
  const owners = context.moduleMap.owners;
  /** @type {Map<string,ModuleDependency>} */
  const dependencies = new Map();
  /** @param {string} file @param {string} resolved @param {{line:number,column:number}} position @param {string} symbol */
  function add(file, resolved, position, symbol) {
    const source = owners.get(file),
      target = owners.get(resolved);
    if (source && target && source !== target) {
      const key = [source, target, file, resolved, position.line, position.column, symbol].join('\0');
      if (!dependencies.has(key))
        dependencies.set(key, { source, target, file, resolved, line: position.line, column: position.column, symbol });
    }
  }
  for (const file of context.frontend) {
    if (!owners.has(file.rel)) continue;
    for (const edge of file.dependencies)
      for (const binding of edge.bindings.filter((binding) => binding.kind !== 'export')) {
        const targets =
          binding.importedName === null
            ? [{ rel: edge.resolved, name: '*' }]
            : dependencyOrigins({ ...edge, bindings: [binding] }, context.byPath, () => false, undefined, true);
        for (const target of targets) add(file.rel, target.rel, binding, target.name);
      }
  }
  // Preserve token structure and use production masks only to select references.
  const rust = rustModuleBoundaryContext(context.rust, owners);
  for (const edge of rustImportDependencies(rust)) {
    const file = /** @type {import('./context.mjs').ArchitectureFile} */ (context.byPath.get(edge.file));
    if (file.rust.code.slice(edge.offset, edge.offset + 3).trim()) add(edge.file, edge.target, edge, edge.symbol);
  }
  for (const file of context.rust)
    for (const asset of file.rust.embeddedAssets) if (asset.path) add(file.rel, asset.path, asset, asset.macro);
  return [...dependencies.values()];
}

/** @param {import('./context.mjs').ArchitectureContext} context @returns {ModuleDependency[]} */
export function moduleDependencies(context) {
  const edges = new Map();
  for (const edge of moduleDependencyEdges(context)) {
    const key = edge.source + '\0' + edge.target;
    if (!edges.has(key)) edges.set(key, edge);
  }
  return [...edges.values()];
}
