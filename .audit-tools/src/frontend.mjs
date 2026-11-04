import ts from 'typescript';
import { cruise } from 'dependency-cruiser';
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';
import { execute, toolRoot, writeJson } from './runtime.mjs';
import { frontendSource } from './frontend-source.mjs';
import { frontendProtocols } from './frontend-protocols.mjs';

/** Runs configured official projects sequentially and preserves their raw evidence.
 * @param {import('./model.mjs').AuditInputSnapshot} snapshot @param {string} directory */
export async function indexFrontend(snapshot, directory) {
  const started = performance.now(),
    input = join(directory, 'frontend-input.json.gz');
  await writeFile(input, gzipSync(JSON.stringify(snapshot)));
  const configs = snapshot.files
    .filter((file) => /(?:^|\/)tsconfig(?:\.[^.]+)?\.json$/.test(file.path))
    .map((file) => file.path)
    .sort((a, b) => Number(b === 'tsconfig.json') - Number(a === 'tsconfig.json') || a.localeCompare(b));
  /** @type {any[]} */
  const projects = [];
  const preferred = new Map();
  async function* indexes() {
    for (const config of configs) {
      const file = join(snapshot.root, config),
        json = ts.readConfigFile(file, ts.sys.readFile),
        parsed = ts.parseJsonConfigFileContent(json.config, ts.sys, dirname(file), undefined, file, undefined, [
          { extension: 'vue', isMixedContent: true, scriptKind: ts.ScriptKind.Deferred },
        ]);
      if (
        config !== 'tsconfig.json' &&
        !config.endsWith('/tsconfig.json') &&
        !json.config.include &&
        !json.config.files &&
        !json.config.references
      )
        continue;
      if (!parsed.fileNames.length) continue;
      const name = 'frontend-' + projects.length,
        output = join(directory, name + '.json.gz');
      const run = await execute(process.execPath, [join(toolRoot, 'src/frontend-semantic.mjs'), input, config, output], {
        cwd: snapshot.root,
        logs: directory,
        name,
      });
      const facts = JSON.parse(gunzipSync(await readFile(output)).toString('utf8'));
      projects.push({ config: facts.config, roots: facts.roots.length, files: facts.sourcePaths.length });
      for (const root of facts.roots) if (!preferred.has(root)) preferred.set(root, config);
      console.log('Frontend ' + config + ': ' + facts.records.length + ' positions; ' + JSON.parse(run.stdout).maxRssMiB + ' MiB');
      yield facts;
    }
  }
  const result = await assembleFrontend(snapshot, indexes(), preferred);
  const config = ts.findConfigFile(snapshot.root, ts.sys.fileExists),
    caller = process.cwd();
  let resources;
  process.chdir(snapshot.root);
  try {
    const raw = await cruise(
      snapshot.files.filter((file) => /\.(?:[cm]?[jt]sx?|vue)$/.test(file.path)).map((file) => file.path),
      {
        baseDir: snapshot.root,
        outputType: 'json',
        tsPreCompilationDeps: 'specify',
        detectJSDocImports: true,
        doNotFollow: { dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'core'] },
        ...(config ? { tsConfig: { fileName: config } } : {}),
        exclude: { path: '(^|/)(?:node_modules|target|dist|release|\\.audit-tools|\\.git)(/|$)|\\.zcode/plans/' },
      },
      { exportsFields: ['exports'], conditionNames: ['import', 'node', 'default'], mainFields: ['module', 'main', 'types'] },
    );
    resources = typeof raw.output === 'string' ? JSON.parse(raw.output) : raw.output;
  } finally {
    process.chdir(caller);
  }
  await writeJson(join(directory, 'frontend-resources.json'), resources);
  const maintained = new Set(snapshot.files.map((file) => file.path));
  for (const module of resources.modules)
    for (const dependency of module.dependencies) {
      const target = dependency.resolved.replaceAll('\\', '/');
      if (maintained.has(module.source) && maintained.has(target) && !/\.(?:[cm]?[jt]sx?|vue)$/.test(target))
        result.edges.push({
          source: module.source,
          target,
          kind: 'asset',
          line:
            result.modules.find((/** @type {any} */ entry) => entry.path === module.source && entry.specifier === dependency.module)
              ?.line ?? null,
          symbols: dependency.module,
          parser: 'dependency-cruiser resource resolution',
          dependencyClass: 'usage',
        });
    }
  const indexed = {
    ...result,
    seconds: (performance.now() - started) / 1000,
    engines: {
      typescript: ts.version,
      vueLanguageCore: JSON.parse(await readFile(fileURLToPath(import.meta.resolve('@vue/language-core/package.json')), 'utf8')).version,
      volarTypescript: JSON.parse(await readFile(fileURLToPath(import.meta.resolve('@volar/typescript/package.json')), 'utf8')).version,
      projects,
    },
  };
  await writeFile(join(directory, 'frontend.json.gz'), gzipSync(JSON.stringify(indexed)));
  return indexed;
}

/** Combines engine evidence by actual source position and configured ownership.
 * @param {import('./model.mjs').AuditInputSnapshot} snapshot @param {Iterable<any> | AsyncIterable<any>} projects @param {Map<string,string>} preferred */
export async function assembleFrontend(snapshot, projects, preferred) {
  const selected = new Map(),
    modules = new Map(),
    calls = new Map(),
    functions = new Map(),
    declarations = new Map(),
    issues = [],
    files = new Map(snapshot.files.map((file) => [file.path, file]));
  const sourcePaths = new Set();
  for await (const project of projects) {
    for (const source of project.sourcePaths) sourcePaths.add(source);
    for (const [values, destination, key] of /** @type {[any[],Map<string,any>,(value:any)=>string][]} */ ([
      [project.records, selected, (row) => [row.path, row.start, row.length, row.group].join(':')],
      [project.modules, modules, (row) => [row.path, row.start, row.specifier].join(':')],
      [project.calls, calls, (row) => [row.path, row.line, row.column, row.target?.id].join(':')],
      [project.functions, functions, (row) => row.id],
      [project.declarations, declarations, (row) => row.path + ':' + row.line + ':' + row.name],
    ]))
      for (const row of values)
        if (!destination.has(key(row)) || preferred.get(row.path) === project.config) destination.set(key(row), row);
    issues.push(...project.issues);
  }
  for (const file of snapshot.files.filter((file) => /\.(?:[cm]?[jt]sx?|vue)$/.test(file.path))) {
    if (sourcePaths.has(file.path)) continue;
    for (const site of frontendSource(file).sites)
      selected.set([site.path, site.start, site.length, site.group].join(':'), {
        ...site,
        state: 'outside-project',
        targets: [],
        typeText: '',
        binding: null,
      });
  }
  /** @type {import('./model.mjs').Edge[]} */
  const edges = [];
  const emitted = new Set();
  for (const row of selected.values()) {
    if (
      !row.targets.length &&
      !['language-intrinsic', 'indexed-contract', 'synthetic-contract'].includes(row.state) &&
      row.group !== 'declaration'
    )
      issues.push({
        kind: 'frontend-' + row.state,
        path: row.path,
        line: row.line,
        column: row.column,
        message: row.name + (row.typeText ? ' · ' + row.typeText : ''),
        parser: 'TypeScript + Vue official semantics',
      });
    const endpoints = row.targets.flatMap(
      /** @param {any} target */ (target) => [
        { target, contract: Boolean(target.declarationScope) },
        ...(row.group === 'component' ? (target.valueTargets ?? []) : []).map(
          /** @param {any} target */ (target) => ({ target, contract: false }),
        ),
      ],
    );
    for (const { target, contract } of endpoints) {
      if (!files.has(target.path)) continue;
      const kind =
        row.group === 'import'
          ? 'typescript-import'
          : row.group === 'call'
            ? 'typescript-call'
            : row.group === 'type'
              ? 'typescript-type'
              : 'typescript-reference';
      const key = [row.path, row.start, target.id, kind].join(':');
      if (emitted.has(key)) continue;
      emitted.add(key);
      edges.push({
        source: row.path,
        target: target.path,
        line: row.line,
        column: row.column,
        targetLine: target.line,
        targetColumn: target.column ?? undefined,
        kind,
        symbols: row.name + ' → ' + target.name,
        sourceSymbol: row.binding ?? '',
        targetSymbol: target.id,
        dependencyClass: contract || row.group === 'import' || row.group === 'declaration' ? 'structure' : 'usage',
        parser: 'TypeScript + Vue official semantics',
        evidence: [
          { path: row.path, line: row.line, column: row.column, text: row.name, parser: 'official source mapping' },
          {
            path: target.path,
            line: target.line,
            column: target.column,
            text:
              target.kind +
              ' ' +
              target.name +
              (target.declarationScope ? ' · ' + target.declarationScope + ' contract' : '') +
              (target.generatedStart !== null ? ' · generated offset ' + target.generatedStart : ''),
            parser: 'TypeScript declaration',
          },
        ],
      });
    }
  }
  for (const row of modules.values())
    for (const target of row.targets)
      if (files.has(target.path))
        edges.push({
          source: row.path,
          target: target.path,
          line: row.line,
          column: row.column,
          kind: 'typescript-module',
          symbols: row.specifier,
          dependencyClass: ['dynamic', 'side-effect'].includes(row.kind) ? 'usage' : 'structure',
          parser: 'TypeScript module declaration',
        });
  const protocols = frontendProtocols([...calls.values()], [...functions.values()]);
  return {
    edges,
    issues,
    declarations: [...declarations.values()],
    records: [...selected.values()],
    modules: [...modules.values()],
    commands: protocols.commands,
    events: protocols.events,
    seconds: 0,
    engines: {},
  };
}
