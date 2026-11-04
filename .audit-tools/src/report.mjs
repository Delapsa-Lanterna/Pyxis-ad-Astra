import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, toolRoot, writeJson } from './runtime.mjs';
import { declaredDependencies } from './analyze.mjs';
import { projectDependencies, selectDependencies } from './dependency-graph.mjs';

/** @param {unknown} value */
export const embeddedJson = (value) => JSON.stringify(value).replaceAll('<', '\\u003c');

/** @param {string} value */
const safeId = (value) => hash(value);

/** @param {Map<string, unknown[]>} map @param {string} key @param {unknown} value */
function indexByPath(map, key, value) {
  const entries = map.get(key) ?? [];
  entries.push(value);
  map.set(key, entries);
}

/** @param {import('./model.mjs').Report} report */
function overview(report) {
  const owners = new Map(report.files.map((file) => [file.path, file.ownership.owner]));
  const fileCounts = new Map();
  for (const owner of owners.values()) if (owner) fileCounts.set(owner, (fileCounts.get(owner) ?? 0) + 1);
  const edges = projectDependencies(
    report.files,
    selectDependencies(report.files, report.edges, {
      mode: 'module',
      basis: 'usage',
      scope: 'production',
      relationScope: 'source',
    }),
    'module',
  );
  const grouped = new Map();
  for (const { source, target, reference } of edges) {
    const key = source + '\0' + target;
    const edge = grouped.get(key) ?? { source, target, count: 0, kinds: {} };
    edge.count++;
    edge.kinds[reference.kind] = (edge.kinds[reference.kind] ?? 0) + 1;
    grouped.set(key, edge);
  }
  const issueGroups = new Map();
  for (const issue of report.issues) {
    const group = issueGroups.get(issue.kind) ?? { kind: issue.kind, count: 0, samples: [] };
    group.count++;
    if (group.samples.length < 3) group.samples.push({ path: issue.path, line: issue.line, message: issue.message });
    issueGroups.set(issue.kind, group);
  }
  const ownership = Object.fromEntries(
    ['shared', 'declared', 'candidate', 'conflict', 'unmatched'].map((status) => [
      status,
      report.files.filter((file) => file.ownership.status === status).length,
    ]),
  );
  const roles = Object.fromEntries(
    [...new Set(report.files.map((file) => file.role))].map((role) => [role, report.files.filter((file) => file.role === role).length]),
  );
  const edgeKinds = [...new Set(report.edges.map((edge) => edge.kind))].sort();
  return {
    schemaVersion: 2,
    reportId: report.run.id,
    run: {
      id: report.run.id,
      head: report.run.head,
      digest: report.run.digest,
      startedAt: report.run.startedAt,
      completedAt: report.run.completedAt,
      toolVersion: report.run.toolVersion,
      engines: report.run.engines,
    },
    metrics: {
      modules: report.modules.length,
      files: report.files.length,
      relationships: report.edges.length,
      issues: report.issues.length,
      ownership,
      roles,
      coverage: {
        productionFiles: report.files.filter((file) => file.role === 'production').length,
        declared: report.files.filter((file) => file.role === 'production' && file.ownership.status === 'declared').length,
        shared: report.files.filter((file) => file.role === 'production' && file.ownership.status === 'shared').length,
        missing: report.files
          .filter((file) => file.role === 'production' && !['declared', 'shared'].includes(file.ownership.status))
          .map((file) => file.path),
        affectedReferences: selectDependencies(report.files, report.edges).filter((edge) => {
          const from = report.files.find((file) => file.path === edge.source),
            to = report.files.find((file) => file.path === edge.target);
          return [from, to].some((file) => file && !['declared', 'shared'].includes(file.ownership.status));
        }).length,
      },
    },
    edgeKinds,
    modules: report.modules.map((module) => ({ ...module, fileCount: fileCounts.get(module.id) ?? 0 })),
    files: report.files.map((file) => ({
      id: safeId(file.path),
      path: file.path,
      role: file.role,
      bytes: file.bytes,
      lines: file.lines,
      hash: file.hash,
      ownership: {
        status: file.ownership.status,
        owner: file.ownership.owner,
        candidates: file.ownership.candidates.map(({ module, relation }) => ({ module, relation })),
      },
    })),
    graph: {
      nodes: report.modules.map(({ id, title }) => ({ id, label: title })),
      edges: [...grouped.values()],
    },
    issueCategories: [...issueGroups.values()].sort((left, right) => right.count - left.count),
    cycles: report.cycles,
    exploration: report.exploration
      ? {
          nodes: report.exploration.nodes.map(({ id, label }) => ({ id, label })),
          edges: report.exploration.edges.map(({ source, target, evidence }) => ({
            source,
            target,
            count: evidence.length,
          })),
        }
      : null,
  };
}

/** @param {string} [directory] */
export async function renderShell(directory) {
  const [template, css, client, library, graph, graphLibrary, layoutLibrary] = await Promise.all([
    readFile(join(toolRoot, 'src/report.html'), 'utf8'),
    readFile(join(toolRoot, 'src/report.css'), 'utf8'),
    readFile(join(toolRoot, 'src/report-client.mjs'), 'utf8'),
    readFile(fileURLToPath(import.meta.resolve('vis-network/standalone/umd/vis-network.min.js')), 'utf8'),
    readFile(join(toolRoot, 'src/dependency-graph.mjs'), 'utf8'),
    readFile(fileURLToPath(import.meta.resolve('graphlib/dist/graphlib.min.js')), 'utf8'),
    readFile(fileURLToPath(import.meta.resolve('@dagrejs/dagre/dist/dagre.min.js')), 'utf8'),
  ]);
  const html = template
    .replace('/* AUDIT_STYLE */', css)
    .replace('/* AUDIT_LIBRARY */', () => (library + '\n' + graphLibrary + '\n' + layoutLibrary).replaceAll('</script', '<\\/script'))
    .replace('/* AUDIT_DATA */', '{}')
    .replace('/* AUDIT_CLIENT */', () =>
      client.replace(/^import .* from '\.\/dependency-graph\.mjs';\r?\n/m, () =>
        graph
          .replace(/^import graphlib from 'graphlib';\r?\n/m, 'const graphlib = window.graphlib;\n')
          .replace(/^import dagre from '@dagrejs\/dagre';\r?\n/m, 'const dagre = window.dagre;\n')
          .replaceAll('export function', 'function'),
      ),
    );
  if (directory) await writeFile(join(directory, 'index.html'), html, 'utf8');
  return html;
}

/** @param {unknown[][]} rows */
export function csv(rows) {
  return rows.map((row) => row.map((value) => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\n') + '\n';
}

/** @param {import('./model.mjs').Report} report @param {string} directory */
export async function renderReport(report, directory) {
  await renderShell(directory);
  const owners = new Map(report.files.map((file) => [file.path, file.ownership.owner]));
  const detailsRoot = join(directory, 'files');
  const issuesRoot = join(directory, 'issues');
  await Promise.all([mkdir(detailsRoot, { recursive: true }), mkdir(issuesRoot, { recursive: true })]);
  const issuesByKind = new Map();
  const declarations = new Map();
  const events = new Map();
  const fileEdges = new Map();
  for (const declaration of report.declarations) indexByPath(declarations, declaration.path, declaration);
  for (const event of report.events) indexByPath(events, event.path, event);
  for (const edge of report.edges) {
    indexByPath(fileEdges, edge.source, edge);
    if (edge.target !== edge.source) indexByPath(fileEdges, edge.target, edge);
  }
  for (const issue of report.issues) {
    const entries = issuesByKind.get(issue.kind) ?? [];
    entries.push(issue);
    issuesByKind.set(issue.kind, entries);
  }
  await Promise.all([
    writeJson(join(directory, 'overview.json'), overview(report)),
    writeJson(join(directory, 'graph-index.json'), {
      files: report.files.map((file) => ({ ...file, text: null })),
      edges: report.edges,
    }),
    writeJson(join(directory, 'facts.json'), report),
    ...[...issuesByKind].map(([kind, issues]) => writeFile(join(issuesRoot, safeId(kind) + '.json'), JSON.stringify(issues), 'utf8')),
  ]);
  for (let offset = 0; offset < report.files.length; offset += 48) {
    await Promise.all(
      report.files.slice(offset, offset + 48).map((file) => {
        const detail = {
          file,
          declarations: declarations.get(file.path) ?? [],
          events: events.get(file.path) ?? [],
          edges: fileEdges.get(file.path) ?? [],
        };
        return writeFile(join(detailsRoot, safeId(file.path) + '.json'), JSON.stringify(detail), 'utf8');
      }),
    );
  }
  /** @type {(keyof import('./model.mjs').Edge)[]} */
  const columns = [
    'source',
    'target',
    'kind',
    'dependencyClass',
    'positionKind',
    'line',
    'column',
    'targetLine',
    'targetColumn',
    'sourceSymbol',
    'targetSymbol',
    'conditional',
    'testOnly',
    'symbols',
    'parser',
    'evidence',
  ];
  /** @param {import('./model.mjs').Edge} edge */
  const row = (edge) => columns.map((key) => (key === 'evidence' ? JSON.stringify(edge.evidence ?? []) : edge[key]));
  await Promise.all([
    writeFile(
      join(directory, 'ownership.csv'),
      csv([
        ['path', 'role', 'hash', 'lines', 'status', 'owner', 'candidates', 'evidence', 'sharedEvidence'],
        ...report.files.map((file) => [
          file.path,
          file.role,
          file.hash,
          file.lines,
          file.ownership.status,
          file.ownership.owner,
          file.ownership.candidates.map((candidate) => candidate.module).join('; '),
          JSON.stringify(file.ownership.candidates),
          JSON.stringify(file.ownership.sharedEvidence ?? []),
        ]),
      ]),
      'utf8',
    ),
    ...['combined', 'source', 'communication'].flatMap((relationScope) =>
      ['complete', 'usage'].flatMap((basis) => {
        const suffix = (relationScope === 'combined' ? '' : '-' + relationScope) + (basis === 'usage' ? '-usage' : '');
        const edges = selectDependencies(report.files, report.edges, { basis, scope: 'all', relationScope });
        const moduleEdges = declaredDependencies(report.files, edges);
        return [
          writeFile(join(directory, `dependencies${suffix}.csv`), csv([columns, ...edges.map(row)]), 'utf8'),
          writeFile(
            join(directory, `module-dependencies${suffix}.csv`),
            csv([
              ['sourceModule', 'targetModule', ...columns],
              ...moduleEdges.map((edge) => [owners.get(edge.source), owners.get(edge.target), ...row(edge)]),
            ]),
            'utf8',
          ),
          ...[false, true].map((module) =>
            writeFile(
              join(directory, `${module ? 'module-' : ''}dependencies${suffix}.dot`),
              'digraph dependencies {\n' +
                (module ? moduleEdges : edges)
                  .map(
                    (edge) =>
                      `  ${JSON.stringify(module ? owners.get(edge.source) : edge.source)} -> ${JSON.stringify(module ? owners.get(edge.target) : edge.target)} [label=${JSON.stringify(edge.kind + (edge.dependencyClass ? ' · ' + edge.dependencyClass : ''))}];`,
                  )
                  .join('\n') +
                '\n}\n',
              'utf8',
            ),
          ),
        ];
      }),
    ),
  ]);
}
