/** @template {{source:string,target:string}} T @param {readonly T[]} edges @returns {T[][]} */
export function dependencyCycles(edges) {
  /** @type {Map<string,T[]>} */
  const graph = new Map();
  for (const edge of edges) {
    const outgoing = graph.get(edge.source) ?? [];
    outgoing.push(edge);
    graph.set(edge.source, outgoing);
    if (!graph.has(edge.target)) graph.set(edge.target, []);
  }
  /** @type {Set<string>} */
  const visited = new Set();
  /** @type {Map<string,number>} */
  const active = new Map();
  /** @type {T[]} */
  const trail = [];
  /** @type {T[][]} */
  const cycles = [];
  /** @param {string} source */
  function visit(source) {
    active.set(source, trail.length);
    for (const edge of /** @type {T[]} */ (graph.get(source))) {
      const start = active.get(edge.target);
      if (start !== undefined) cycles.push([...trail.slice(start), edge]);
      else if (!visited.has(edge.target)) {
        trail.push(edge);
        visit(edge.target);
        trail.pop();
      }
    }
    active.delete(source);
    visited.add(source);
  }
  for (const source of graph.keys()) if (!visited.has(source)) visit(source);
  return cycles;
}
