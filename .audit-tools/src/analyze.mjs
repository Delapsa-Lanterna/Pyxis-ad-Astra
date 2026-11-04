import { isTextFile, sharedFiles } from './collect.mjs';
export { cycles } from './dependency-graph.mjs';

/** @param {import('./model.mjs').File[]} files @param {import('./model.mjs').Module[]} modules @returns {Map<string, string>} */
export function declaredRustOwners(files, modules) {
  const shared = sharedFiles(files);
  const owners = new Map();
  for (const file of files) {
    if (shared.has(file.path)) continue;
    const candidates = new Set(
      modules
        .filter((module) =>
          module.references.some(
            (reference) => reference.kind === 'owns' && (file.path === reference.path || file.path.startsWith(reference.path + '/')),
          ),
        )
        .map((module) => module.id),
    );
    if (candidates.size === 1) owners.set(file.path, /** @type {string} */ (candidates.values().next().value));
  }
  return owners;
}

/** @param {import('./model.mjs').File[]} files @param {import('./model.mjs').Module[]} modules @param {import('./model.mjs').Edge[]} edges @param {import('./model.mjs').RustFacts['moduleParents']} [moduleParents] */
export function inferOwnership(files, modules, edges, moduleParents = []) {
  const shared = sharedFiles(files);
  /** @type {Map<string, import('./model.mjs').Candidate[]>} */
  const evidence = new Map();
  for (const file of files) {
    /** @type {import('./model.mjs').Candidate[]} */
    const candidates = [];
    for (const module of modules) {
      if (file.path === module.path)
        candidates.push({
          module: module.id,
          relation: 'owns',
          evidence: [{ path: module.path, line: 1, text: module.title, parser: 'module-document' }],
        });
      for (const reference of module.references) {
        const exact = file.path === reference.path;
        if (!exact && !file.path.startsWith(reference.path + '/')) continue;
        candidates.push({
          module: module.id,
          relation: reference.kind,
          evidence: [
            {
              path: module.path,
              line: reference.line,
              text: reference.path + '：' + reference.role,
              parser: 'module-document',
            },
          ],
        });
      }
    }
    evidence.set(file.path, candidates);
  }
  const paths = new Set(files.map((file) => file.path));
  for (const file of files) {
    const paired = /\.spec\.[cm]?[jt]sx?$/.test(file.path)
      ? [file.path.replace(/\.spec(\.[cm]?[jt]sx?)$/, '$1'), file.path.replace(/\.spec\.[cm]?[jt]sx?$/, '.vue')]
      : /_tests?\.rs$/.test(file.path)
        ? [file.path.replace(/_tests?\.rs$/, '.rs')]
        : [];
    for (const production of paired.filter((path) => paths.has(path))) {
      for (const item of /** @type {import('./model.mjs').Candidate[]} */ (evidence.get(production)))
        /** @type {import('./model.mjs').Candidate[]} */ (evidence.get(file.path)).push({
          ...item,
          relation: item.relation === 'owns' ? 'test-owner' : 'test-' + item.relation,
          evidence: [...item.evidence, { path: production, line: 1, text: `Colocated test: ${file.path}`, parser: 'file-pair' }],
        });
    }
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  /** @type {Map<string, import('./model.mjs').RustFacts['moduleParents']>} */
  const parents = new Map();
  for (const relation of moduleParents.filter((entry) => byPath.get(entry.childPath)?.role === 'test')) {
    const entries = parents.get(relation.childPath) ?? [];
    entries.push(relation);
    parents.set(relation.childPath, entries);
  }
  /** @param {string} path @param {Set<string>} [seen] @returns {{owner: string | null, evidence: import('./model.mjs').Evidence[]}[]} */
  function inheritedRustOwnership(path, seen = new Set()) {
    if (seen.has(path)) return [];
    const visited = new Set(seen).add(path);
    return (parents.get(path) ?? []).flatMap((relation) => {
      const parent = byPath.get(relation.parentPath);
      if (!parent) return [];
      const inclusion = {
        path: relation.parentPath,
        line: relation.line,
        text: `Rust test module includes ${path}`,
        parser: 'rust-module',
      };
      const publicEvidence = shared.get(parent.path);
      if (publicEvidence) return [{ owner: null, evidence: [...publicEvidence, inclusion] }];
      const ownership = initial.get(relation.parentPath);
      if (ownership?.status === 'declared' && ownership.owner)
        return [
          {
            owner: ownership.owner,
            evidence: [...ownership.candidates.flatMap((candidate) => candidate.evidence), inclusion],
          },
        ];
      if (parent.role !== 'test') return [];
      return inheritedRustOwnership(relation.parentPath, visited).map((entry) => ({
        ...entry,
        evidence: [
          ...entry.evidence,
          {
            path: relation.parentPath,
            line: relation.line,
            text: `Nested Rust test module includes ${path}`,
            parser: 'rust-module',
          },
        ],
      }));
    });
  }
  /** @param {import('./model.mjs').Candidate[]} items @returns {import('./model.mjs').Ownership} */
  function projection(items) {
    const owners = [...new Set(items.filter((item) => ['owns', 'test-owner'].includes(item.relation)).map((item) => item.module))];
    const candidates = new Map();
    for (const item of items) {
      const key = item.module + '#' + item.relation;
      const candidate = candidates.get(key) ?? { ...item, evidence: [] };
      candidate.evidence.push(...item.evidence);
      candidates.set(key, candidate);
    }
    return {
      status: owners.length === 1 ? 'declared' : owners.length > 1 ? 'conflict' : items.length ? 'candidate' : 'unmatched',
      owner: owners.length === 1 ? /** @type {string} */ (owners[0]) : null,
      candidates: [...candidates.values()],
    };
  }
  const initial = new Map(
    [...evidence].map(([path, entries]) => [
      path,
      shared.has(path) ? { status: 'shared', owner: null, candidates: [] } : projection(entries),
    ]),
  );
  for (const file of files.filter((entry) => entry.role === 'test')) {
    if (initial.get(file.path)?.status === 'declared' || initial.get(file.path)?.status === 'conflict') continue;
    const inherited = inheritedRustOwnership(file.path);
    for (const entry of inherited) {
      if (entry.owner === null) {
        shared.set(file.path, [...(shared.get(file.path) ?? []), ...entry.evidence]);
        continue;
      }
      evidence.get(file.path)?.push({
        module: entry.owner,
        relation: 'test-owner',
        evidence: entry.evidence,
      });
    }
  }
  for (const file of files) {
    if (shared.has(file.path)) {
      file.ownership = { status: 'shared', owner: null, candidates: [], sharedEvidence: shared.get(file.path) };
      continue;
    }
    const items = /** @type {import('./model.mjs').Candidate[]} */ (evidence.get(file.path));
    if (!items.some((item) => ['owns', 'test-owner'].includes(item.relation)))
      for (const edge of edges.filter((edge) => edge.kind !== 'document-reference' && edge.target === file.path)) {
        const module = initial.get(edge.source)?.owner;
        if (module)
          items.push({
            module,
            relation: 'consumer-reference',
            evidence: [{ path: edge.source, line: edge.line, text: `${edge.kind}: ${edge.symbols}`, parser: edge.parser }],
          });
      }
    file.ownership = projection(items);
  }
}

/** @param {import('./model.mjs').Module[]} modules @param {import('./model.mjs').File[]} files @returns {import('./model.mjs').Edge[]} */
export function documentEdges(modules, files) {
  return modules.flatMap((module) =>
    module.references.flatMap((reference) =>
      files
        .filter((file) => file.path === reference.path || file.path.startsWith(reference.path + '/'))
        .map((file) => ({
          source: module.path,
          target: file.path,
          kind: 'document-reference',
          line: reference.line,
          symbols: reference.role,
          parser: 'module-document',
        })),
    ),
  );
}

/** @param {import('./model.mjs').File[]} files @param {import('./model.mjs').Edge[]} edges */
export function declaredDependencies(files, edges) {
  const owners = new Map(files.map((file) => [file.path, file.ownership.owner]));
  return edges.filter(
    (edge) =>
      edge.kind !== 'document-reference' &&
      owners.get(edge.source) &&
      owners.get(edge.target) &&
      owners.get(edge.source) !== owners.get(edge.target),
  );
}

/** @param {import('./model.mjs').File[]} files @returns {import('./model.mjs').Edge[]} */
export function styleEdges(files) {
  const paths = new Set(files.map((file) => file.path));
  return files
    .filter(isTextFile)
    .filter((file) => file.path.endsWith('.css'))
    .flatMap((file) =>
      [...file.text.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/g)].flatMap((match) => {
        const specifier = /** @type {string} */ (match[1]);
        const segments = file.path.split('/');
        segments.pop();
        for (const part of specifier.split('/')) {
          if (part === '..') segments.pop();
          else if (part !== '.') segments.push(part);
        }
        const target = segments.join('/');
        return paths.has(target)
          ? [
              {
                source: file.path,
                target,
                kind: 'style-import',
                line: file.text.slice(0, match.index).split('\n').length,
                symbols: specifier,
                parser: 'CSS literal @import',
              },
            ]
          : [];
      }),
    );
}

/** @param {import('./model.mjs').Event[]} commands @param {Map<string, import('./model.mjs').Declaration[]>} registered */
export function ipcEdges(commands, registered) {
  /** @type {import('./model.mjs').Edge[]} */
  const edges = [];
  /** @type {import('./model.mjs').Issue[]} */
  const issues = [];
  for (const call of commands.filter(
    /** @returns {call is import('./model.mjs').Event & {value: string}} */ (call) => call.value !== null,
  )) {
    const targets = (registered.get(call.value) ?? []).filter((target) => call.testOnly || !target.testOnly);
    if (targets.length === 1) {
      const target = /** @type {import('./model.mjs').Declaration} */ (targets[0]);
      edges.push({
        source: call.path,
        target: target.path,
        line: call.line,
        targetLine: target.line,
        kind: 'ipc',
        testOnly: call.testOnly || target.testOnly || false,
        symbols: call.value,
        parser: call.parser + ' + registered Rust command declaration',
      });
    } else
      issues.push({
        kind: 'ipc-target',
        path: call.path,
        line: call.line,
        testOnly: Boolean(call.testOnly),
        message: `${call.value}: ${targets.length} matching registered declarations`,
        parser: call.parser,
      });
  }
  return { edges, issues };
}

/** @param {import('./model.mjs').Event[]} events @returns {import('./model.mjs').Edge[]} */
export function eventEdges(events) {
  const outputs = events.filter(
    /** @returns {event is import('./model.mjs').Event & {value: string}} */ (event) => event.role === 'emit' && event.value !== null,
  );
  const inputs = events.filter((event) => event.role === 'listen' && event.value !== null);
  return outputs.flatMap((output) =>
    inputs
      .filter((input) => input.value === output.value)
      .map((input) => ({
        source: output.path,
        target: input.path,
        line: output.line,
        targetLine: input.line,
        kind: 'window-event',
        testOnly: Boolean(output.testOnly || input.testOnly),
        symbols: output.value,
        parser: output.parser + ' + ' + input.parser,
        evidence: [
          { path: output.path, line: output.line, text: 'Emit topic: ' + output.expression, parser: output.parser },
          { path: input.path, line: input.line, text: 'Listen topic: ' + input.expression, parser: input.parser },
        ],
      })),
  );
}

/** @param {import('./model.mjs').Report} report */
export function validateReport(report) {
  const paths = new Set(report.files.map((file) => file.path));
  const modules = new Set(report.modules.map((module) => module.id));
  for (const file of report.files)
    for (const candidate of file.ownership.candidates)
      if (!modules.has(candidate.module)) throw new Error(`Unknown ownership module: ${candidate.module}`);
  for (const edge of report.edges) {
    if (!paths.has(edge.source) || (!paths.has(edge.target) && !edge.target.startsWith('external:')))
      throw new Error(`Unknown dependency endpoint: ${edge.source} → ${edge.target}`);
    if (!edge.parser) throw new Error(`Dependency without provenance: ${edge.source}`);
  }
  if (!report.modules.length || !report.files.length) throw new Error('Empty audit input');
}
