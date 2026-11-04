import { mkdir, readFile, readdir, rename, rm, copyFile, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { collect, assertUnchanged, readModules } from './collect.mjs';
import { indexFrontend } from './frontend.mjs';
import { gunzipSync } from 'node:zlib';
import { parseRust } from './rust.mjs';
import { syntaxIdentity } from './rust-syntax.mjs';
import { indexRustWorkspace, readSemanticIndex, semanticVersion } from './rust-semantic.mjs';
import { declaredRustOwners, documentEdges, eventEdges, inferOwnership, ipcEdges, styleEdges, validateReport } from './analyze.mjs';
import { renderReport } from './report.mjs';
import { dependencyCycles } from './dependency-graph.mjs';
import { execute, hash, lock, outputRoot, ownedPath, projectRoot, python, runtimeRoot, toolRoot, writeJson, publish } from './runtime.mjs';

/** @param {string} root @param {string} work */
async function graphify(root, work) {
  const directory = join(work, 'graphify');
  await execute(python, ['-m', 'graphify', 'extract', root, '--code-only', '--out', directory, '--timing'], {
    cwd: root,
    logs: join(work, 'commands'),
    name: 'graphify-extract',
  });
  await execute(python, ['-m', 'graphify', 'cluster-only', directory, '--no-label', '--timing'], {
    cwd: root,
    logs: join(work, 'commands'),
    name: 'graphify-cluster',
  });
  const graph = JSON.parse(await readFile(join(directory, 'graphify-out/graph.json'), 'utf8'));
  /** @type {Map<string, {id: string, label: string, files: string[]}>} */
  const clusters = new Map();
  /** @type {Map<string, {community: string, label: string, source_file: string, source_location: string}>} */
  const symbols = new Map();
  for (const node of graph.nodes) {
    const id = String(node.community);
    symbols.set(node.id, { ...node, community: id });
    const cluster = clusters.get(id) ?? { id, label: '聚类 ' + id, files: [] };
    if (node.source_file && !cluster.files.includes(node.source_file)) cluster.files.push(node.source_file);
    clusters.set(id, cluster);
  }
  /** @type {Map<string, {source: string, target: string, evidence: string[]}>} */
  const edges = new Map();
  for (const link of graph.links) {
    const source = symbols.get(link.source),
      target = symbols.get(link.target);
    if (!source || !target) throw new Error('Graphify relationship has a missing symbol endpoint');
    if (source.community === target.community) continue;
    const key = source.community + '#' + target.community;
    const edge = edges.get(key) ?? { source: source.community, target: target.community, evidence: [] };
    edge.evidence.push(
      `${link.relation} · ${link.confidence} · ${source.label} → ${target.label} · ${link.source_file ?? source.source_file ?? ''}:${link.source_location ?? source.source_location ?? ''}`,
    );
    edges.set(key, edge);
  }
  return { nodes: [...clusters.values()], edges: [...edges.values()] };
}

/** @param {string} root @param {{graphify?: boolean, dryRun?: boolean, replayBaseline?: boolean}} [options] @param {{runtimeRoot: string, outputRoot: string}} [storage] */
export async function scan(root, options = {}, storage = { runtimeRoot, outputRoot }) {
  const runtime = storage.runtimeRoot,
    output = storage.outputRoot;
  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          root,
          engines: [
            'typescript@6.0.3 + vue-language-tools@3.3.13',
            'dependency-cruiser@18.6.0 resources',
            'rust-analyzer@' + semanticVersion,
            ...(options.graphify ? ['graphify@0.9.90'] : []),
          ],
          runtimeRoot: runtime,
          outputRoot: output,
        },
        null,
        2,
      ),
    );
    return;
  }
  const release = await lock(runtime, 'scan');
  const started = new Date().toISOString();
  const id = 'scan-' + started.replaceAll(/[:.]/g, '-') + '-' + process.pid;
  const work = ownedPath(runtime, join(runtime, 'logs', 'scan', id));
  /** @param {string} phase @param {string} activity */
  async function progress(phase, activity) {
    await writeJson(join(runtime, 'last-run.json'), { id, status: 'running', startedAt: started, phase, activity });
    console.log(activity);
  }
  try {
    await mkdir(join(work, 'commands'), { recursive: true });
    await mkdir(join(runtime, 'work/tmp'), { recursive: true });
    await progress('收集文件', 'Collect input snapshot');
    const previousId = options.replayBaseline ? JSON.parse(await readFile(join(output, 'current.json'), 'utf8')).id : null;
    const previousDirectory = previousId ? join(output, previousId) : null;
    const previousText = previousDirectory ? await readFile(join(previousDirectory, 'facts.json'), 'utf8') : null;
    const previous = previousText ? /** @type {import('./model.mjs').Report} */ (JSON.parse(previousText)) : null;
    const snapshot = previous
      ? {
          files: previous.files,
          head: String(previous.run.head),
          digest: String(previous.run.digest),
          root: String(previous.run.root),
        }
      : await collect(root);
    const docs = readModules(snapshot);
    console.log(`Collect ${snapshot.files.length} files, ${docs.modules.length} modules; ${snapshot.digest}`);
    await progress('分析前端', 'Analyze frontend');
    if (previousDirectory) await cp(join(previousDirectory, 'raw/commands'), join(work, 'commands'), { recursive: true });
    const frontend = previousDirectory
      ? JSON.parse(gunzipSync(await readFile(join(previousDirectory, 'raw/frontend.json.gz'))).toString('utf8'))
      : await indexFrontend(snapshot, join(work, 'commands'));
    const facts = frontend,
      front = frontend,
      protocols = frontend;
    await progress('分析 Rust', 'Analyze Rust');
    const semanticRun =
      previousDirectory && previous
        ? {
            .../** @type {{rustSemantic:Awaited<ReturnType<typeof indexRustWorkspace>>}} */ (previous.run.engines).rustSemantic,
            reusedFrom: previousId,
          }
        : await indexRustWorkspace(
            root,
            snapshot.files.filter((file) => file.path.endsWith('Cargo.toml')).map((file) => file.path),
            join(work, 'commands'),
          );
    if (!semanticRun.runs) throw new Error('Baseline requires its original Rust semantic index and engine metadata');
    const semanticSources = await Promise.all(
      semanticRun.runs.map((_, index) => readFile(join(work, 'commands', 'rust-semantic-' + index + '.stdout.txt'), 'utf8')),
    );
    const semantic = readSemanticIndex(snapshot.root, semanticSources);
    const targets = JSON.parse(await readFile(join(work, 'commands', 'rust-targets.json'), 'utf8'));
    const native = /** @type {{name:string,src_path:string}[]} */ (targets).map((target) => ({ target }));
    const rustStarted = performance.now();
    const rust = await parseRust(snapshot, native, declaredRustOwners(snapshot.files, docs.modules), semantic, semanticRun.cfg);
    const rustSeconds = (performance.now() - rustStarted) / 1000;
    const roles = new Map(snapshot.files.map((file) => [file.path, file.role]));
    for (const item of [...protocols.commands, ...protocols.events]) item.testOnly = roles.get(item.path) === 'test';
    const ipc = ipcEdges(protocols.commands, rust.commands);
    const events = [...protocols.events, ...rust.events];
    const edges = [
      ...front.edges,
      ...rust.edges,
      ...ipc.edges,
      ...eventEdges(events),
      ...styleEdges(snapshot.files),
      ...documentEdges(docs.modules, snapshot.files),
    ];
    inferOwnership(snapshot.files, docs.modules, edges, rust.moduleParents);
    const exploration = options.graphify ? await graphify(root, work) : null;
    const versions = JSON.parse(await readFile(join(toolRoot, 'package.json'), 'utf8'));
    /** @type {import('./model.mjs').Report} */
    const report = {
      schemaVersion: 5,
      run: {
        id,
        ...(previousId ? { replayedFrom: previousId } : {}),
        startedAt: started,
        completedAt: new Date().toISOString(),
        head: snapshot.head,
        digest: snapshot.digest,
        root,
        toolVersion: versions.version,
        toolLock: hash(await readFile(join(projectRoot, 'package-lock.json'))),
        toolSourceDigest: hash(
          (
            await Promise.all(
              (await readdir(join(toolRoot, 'src')))
                .sort()
                .map(async (path) => path + '\0' + hash(await readFile(join(toolRoot, 'src', path)))),
            )
          ).join('\n'),
        ),
        dependencies: versions.dependencies,
        engines: {
          frontend: {
            seconds: frontend.seconds,
            ...frontend.engines,
            positions: frontend.records.length,
            resolutions: Object.fromEntries(
              [...new Set(frontend.records.map((/** @type {any} */ row) => row.state))]
                .sort()
                .map((state) => [state, frontend.records.filter((/** @type {any} */ row) => row.state === state).length]),
            ),
          },
          rustSemantic: semanticRun,
          rustSyntax: await syntaxIdentity(),
          rustReferences: {
            seconds: rustSeconds,
            references: rust.edges.filter((edge) => edge.dependencyClass === 'usage').length,
            resolutions: Object.fromEntries(
              ['type', 'value'].map((space) => [
                space,
                Object.fromEntries(
                  [...new Set(rust.referenceResolutions.filter((entry) => entry.space === space).map((entry) => entry.reason))]
                    .sort()
                    .map((reason) => [
                      reason,
                      rust.referenceResolutions.filter((entry) => entry.space === space && entry.reason === reason).length,
                    ]),
                ),
              ]),
            ),
          },
          graphify: Boolean(options.graphify),
        },
      },
      modules: docs.modules,
      files: snapshot.files,
      edges,
      events,
      declarations: [...facts.declarations, ...rust.declarations],
      issues: [...docs.issues, ...front.issues, ...rust.issues, ...ipc.issues],
      cycles: ['usage', 'complete'].flatMap((basis) =>
        ['production', 'all'].flatMap((scope) =>
          ['source', 'communication', 'combined'].flatMap((relationScope) =>
            ['module', 'file', 'rust'].flatMap((mode) =>
              dependencyCycles(snapshot.files, edges, { basis, scope, mode, relationScope }).map((cycle) => ({
                ...cycle,
                basis,
                scope,
              })),
            ),
          ),
        ),
      ),
      rust: { symbols: rust.symbols, relations: rust.relations },
      exploration,
    };
    validateReport(report);
    await progress('整理并校验', `Render ${edges.length} relationships; ${report.issues.length} coverage issues`);
    const resultDirectory = join(work, 'result');
    await mkdir(join(resultDirectory, 'raw'), { recursive: true });
    await renderReport(report, resultDirectory);
    await writeJson(join(resultDirectory, 'raw/rust-reference-resolutions.json'), rust.referenceResolutions);
    await copyFile(
      join(previousDirectory ?? work, previousDirectory ? 'raw/frontend.json.gz' : 'commands/frontend.json.gz'),
      join(resultDirectory, 'raw/frontend.json.gz'),
    );
    await rename(join(work, 'commands'), join(resultDirectory, 'raw/commands'));
    if (options.graphify) await copyFile(join(work, 'graphify/graphify-out/graph.json'), join(resultDirectory, 'raw/graphify.json'));
    if (previousDirectory) {
      if ((await readFile(join(previousDirectory, 'facts.json'), 'utf8')) !== previousText)
        throw new Error('Baseline evidence changed during replay');
    } else assertUnchanged(snapshot, await collect(root));
    await progress('发布报告', 'Publish verified report');
    await publish(output, id, resultDirectory);
    await rm(work, { recursive: true });
    const metadata = {
      id,
      status: 'success',
      digest: snapshot.digest,
      completedAt: new Date().toISOString(),
      files: snapshot.files.length,
      edges: edges.length,
      issues: report.issues.length,
    };
    await writeJson(join(runtime, 'last-run.json'), metadata);
    console.log(JSON.stringify(metadata, null, 2));
    return report;
  } catch (error) {
    const failure = String(error);
    await writeJson(join(runtime, 'last-run.json'), {
      id,
      status: 'failed',
      startedAt: started,
      error: failure,
      logPath: work,
      completedAt: new Date().toISOString(),
    });
    throw error;
  } finally {
    await release();
  }
}
