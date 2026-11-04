import graphlib from 'graphlib';
import dagre from '@dagrejs/dagre';
/** @param {import('./model.mjs').DependencyGraph} view */
export function dependencyPositions(view) {
  const graph = new dagre.graphlib.Graph();
  graph.setGraph({
    rankdir: 'TB',
    acyclicer: 'greedy',
    ranker: 'network-simplex',
    ranksep: 110,
    nodesep: 55,
    edgesep: 16,
    marginx: 30,
    marginy: 30,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of [...view.nodes].sort((a, b) => a.id.localeCompare(b.id)))
    graph.setNode(node.id, { width: Math.min(220, Math.max(100, node.label.length * 14 + 28)), height: 48 });
  for (const edge of view.edges) graph.setEdge(edge.source, edge.target, { weight: 1, minlen: 1 });
  dagre.layout(graph);
  const bottom = Math.max(0, ...graph.nodes().map((id) => graph.node(id).y));
  return new Map(
    view.nodes.map((node) => {
      const point = graph.node(node.id);
      return [
        node.id,
        {
          x: point.x,
          y: /** @type {import('@dagrejs/dagre').Edge[]} */ (graph.outEdges(node.id)).length ? point.y : bottom,
        },
      ];
    }),
  );
}
/** @param {import('./model.mjs').DependencyGraph} view */
export function layeredDependencies(view) {
  const graph = new graphlib.Graph({ directed: true });
  for (const node of view.nodes) graph.setNode(node.id);
  for (const edge of view.edges) graph.setEdge(edge.source, edge.target);
  const components = graphlib.alg.tarjan(graph).map((members) => members.sort());
  const owners = new Map(components.flatMap((members, index) => members.map((id) => [id, index])));
  const groups = components.map((members, index) => ({ id: String(index), members, level: -1 }));
  const links = new Map();
  for (const edge of view.edges) {
    const source = String(owners.get(edge.source)),
      target = String(owners.get(edge.target));
    if (source === target) continue;
    const key = source + ':' + target;
    const link = links.get(key) ?? { source, target, count: 0 };
    link.count += edge.count;
    links.set(key, link);
  }
  const edges = [...links.values()];
  const dependencies = new Map(
    groups.map((group) => [group.id, edges.filter((edge) => edge.source === group.id).map((edge) => Number(edge.target))]),
  );
  /** @param {number} index @returns {number} */
  function level(index) {
    const group = /** @type {{id: string, members: string[], level: number}} */ (groups[index]);
    if (group.level >= 0) return group.level;
    group.level = Math.max(-1, .../** @type {number[]} */ (dependencies.get(group.id)).map(level)) + 1;
    return group.level;
  }
  for (const [index] of groups.entries()) level(index);
  return { groups, edges };
}
/** @typedef {{basis?: string, scope?: string, mode?: string, kind?: string, relationScope?: string}} Selection */

/** @param {import('./model.mjs').File[]} files @param {import('./model.mjs').Edge[]} edges @param {Selection} [selection] */
export function selectDependencies(
  files,
  edges,
  { basis = 'usage', scope = 'production', mode = 'file', kind = 'all', relationScope = 'source' } = {},
) {
  const paths = new Set(
    files
      .filter((file) => (scope === 'all' || file.role === scope) && (mode !== 'rust' || file.path.endsWith('.rs')))
      .map((file) => file.path),
  );
  return edges.filter(
    (edge) =>
      paths.has(edge.source) &&
      paths.has(edge.target) &&
      (scope !== 'production' || !edge.testOnly) &&
      (basis === 'complete' || edge.dependencyClass !== 'structure') &&
      (mode !== 'rust' || edge.kind.startsWith('rust-')) &&
      (relationScope === 'combined' || (relationScope === 'communication') === ['ipc', 'window-event'].includes(edge.kind)) &&
      (kind === 'all' ? edge.kind !== 'document-reference' : edge.kind === kind),
  );
}

/** @param {import('./model.mjs').File[]} files @param {import('./model.mjs').Edge[]} edges @param {Selection} [selection] */
export function dependencyCycles(files, edges, selection = {}) {
  const mode = selection.mode ?? 'file';
  const selected = selectDependencies(files, edges, selection);
  const sourceCycles = cycles(
    projectDependencies(
      files,
      selected.filter((edge) => !['ipc', 'window-event'].includes(edge.kind)),
      mode,
    ),
    mode,
  );
  return cycles(projectDependencies(files, selected, mode), mode).map((cycle) => ({
    ...cycle,
    relationScope: selection.relationScope ?? 'source',
    category: sourceCycles.some((source) => source.members.every((member) => cycle.members.includes(member))) ? 'source' : 'communication',
  }));
}

/** @param {import('./model.mjs').File[]} files @param {import('./model.mjs').Edge[]} edges @param {string} mode */
export function projectDependencies(files, edges, mode) {
  const owners = new Map(files.map((file) => [file.path, file.ownership.owner]));
  return edges.flatMap((reference) => {
    const source = mode === 'module' ? owners.get(reference.source) : reference.source;
    const target = mode === 'module' ? owners.get(reference.target) : reference.target;
    return source && target && (mode !== 'module' || source !== target) ? [{ source, target, reference }] : [];
  });
}

/** @param {{source: string, target: string}[]} edges @param {string} kind */
export function cycles(edges, kind) {
  const graph = new graphlib.Graph({ directed: true });
  for (const { source, target } of edges) {
    if (source === target) continue;
    graph.setNode(source);
    graph.setNode(target);
    graph.setEdge(source, target);
  }
  /** @type {{kind: string, members: string[], chain: string[]}[]} */
  const result = [];
  for (const members of graphlib.alg.tarjan(graph)) {
    if (members.length < 2) continue;
    members.sort();
    const allowed = new Set(members),
      start = /** @type {string} */ (members[0]);
    const queue = [[start]],
      seen = new Set([start]);
    let closed = false;
    for (let cursor = 0; cursor < queue.length && !closed; cursor++) {
      const path = /** @type {string[]} */ (queue[cursor]);
      for (const next of /** @type {string[]} */ (graph.successors(/** @type {string} */ (path.at(-1))))) {
        if (next === start) {
          result.push({ kind, members, chain: [...path, start] });
          closed = true;
          break;
        }
        if (allowed.has(next) && !seen.has(next)) {
          seen.add(next);
          queue.push([...path, next]);
        }
      }
    }
  }
  return result.sort(
    (left, right) =>
      right.members.length - left.members.length ||
      /** @type {string} */ (left.members[0]).localeCompare(/** @type {string} */ (right.members[0])),
  );
}
