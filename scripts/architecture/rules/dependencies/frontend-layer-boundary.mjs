import { defineRule } from '../../diagnostics.mjs';
import { frontendDependencyFailure } from './frontend-policy.mjs';
import { frontendFile, specFile, classifyFrontendPath } from '../../facts/classify.mjs';

export const frontendLayerBoundaryRule = defineRule(
  'frontend-layer-boundary',
  '.zcode/overview.md#前端',
  import.meta.url,
  (context, report) => {
    for (const file of context.frontend) {
      const rejected = new Set();
      for (const edge of file.dependencies) {
        const reason = frontendDependencyFailure(file.role, classifyFrontendPath(edge.resolved), edge);
        const key = edge.resolved + ':' + reason?.message;
        if (reason && !rejected.has(key)) report(file, edge, reason.message, { target: edge.resolved, expected: reason.expected });
        rejected.add(key);
      }
      for (const access of file.accesses) {
        const global = ['localStorage', 'sessionStorage', 'indexedDB'].find(
          (name) =>
            access.localName === name ||
            (access.localName !== null && ['globalThis', 'window', 'self'].includes(access.localName) && access.member === name),
        );
        if (global && !file.imports.some((binding) => binding.localName === access.localName))
          report(file, access, 'app state persistence must use app config services', { symbol: global, expected: 'app config services' });
      }
    }
    const modules = context.files.filter((file) => frontendFile(file.rel) && !specFile(file.rel));
    const graph = new Map(
      modules.map((file) => [
        file.rel,
        file.dependencies.filter((edge) => context.byPath.has(edge.resolved) && frontendFile(edge.resolved) && !specFile(edge.resolved)),
      ]),
    );
    const visited = new Set();
    const active = new Set();
    /** @param {string} rel @param {string[]} trail */
    function visit(rel, trail) {
      if (visited.has(rel)) return;
      active.add(rel);
      const file = context.byPath.get(rel);
      if (!file) return;
      for (const edge of /** @type {import('../../facts/imports.mjs').ResolvedImport[]} */ (graph.get(rel))) {
        if (active.has(edge.resolved))
          report(
            file,
            edge,
            'frontend dependency cycle detected: ' + [...trail.slice(trail.indexOf(edge.resolved)), rel, edge.resolved].join(' -> '),
            { target: edge.resolved, expected: 'acyclic frontend dependencies' },
          );
        else visit(edge.resolved, [...trail, rel]);
      }
      active.delete(rel);
      visited.add(rel);
    }
    for (const rel of graph.keys()) visit(rel, []);
  },
);
