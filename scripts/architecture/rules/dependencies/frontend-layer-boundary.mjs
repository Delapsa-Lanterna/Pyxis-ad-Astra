import { defineRule } from '../../diagnostics.mjs';
import { frontendDependencyFailure } from './frontend-policy.mjs';
import { frontendFile, specFile, classifyFrontendPath } from '../../facts/classify.mjs';
import { dependencyCycles } from '../../facts/dependency-cycles.mjs';

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
    const edges = modules.flatMap((file) =>
      file.dependencies
        .filter((edge) => context.byPath.has(edge.resolved) && frontendFile(edge.resolved) && !specFile(edge.resolved))
        .map((edge) => ({ source: file.rel, target: edge.resolved, file, edge })),
    );
    for (const cycle of dependencyCycles(edges)) {
      const closing = /** @type {typeof edges[number]} */ (cycle.at(-1));
      report(
        closing.file,
        closing.edge,
        'frontend dependency cycle detected: ' + [...cycle.map((edge) => edge.source), closing.target].join(' -> '),
        { target: closing.target, expected: 'acyclic frontend dependencies' },
      );
    }
  },
);
