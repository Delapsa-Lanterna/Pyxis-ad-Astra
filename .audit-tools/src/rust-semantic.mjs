import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execute, hash, runtimeRoot, writeJson } from './runtime.mjs';

export const semanticVersion = '0.3.3105';
const release = '2026-11-02';
const archiveHash = '5450a3735c601f047dc9ca46a01add55c4ac7ef450ae5e710d249a26d65f5632';
export const semanticExecutable = join(runtimeRoot, 'tools/rust-analyzer/rust-analyzer.exe');

/** Installs the pinned semantic engine into the tool-owned runtime. */
export async function installSemanticEngine() {
  const response = await fetch(
    'https://github.com/rust-lang/rust-analyzer/releases/download/' + release + '/rust-analyzer-x86_64-pc-windows-msvc.zip',
  );
  if (!response.ok) throw new Error('Semantic engine download: HTTP ' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== archiveHash) throw new Error('Semantic engine archive SHA-256 differs from the pinned release');
  const directory = join(runtimeRoot, 'tools/rust-analyzer'),
    archive = join(directory, 'release.zip');
  await mkdir(directory, { recursive: true });
  await writeFile(archive, bytes);
  await execute('tar', ['-xf', archive, '-C', directory], { logs: join(runtimeRoot, 'logs/setup'), name: 'rust-analyzer-extract' });
}

/** @param {string} root @param {string[]} manifests @param {string} directory */
export async function indexRustWorkspace(root, manifests, directory) {
  const workspaces = [...new Set(manifests)].filter(
    (manifest) => !manifests.some((parent) => parent !== manifest && manifest.startsWith(parent.slice(0, -'Cargo.toml'.length))),
  );
  const runs = [],
    targets = [];
  for (const [index, manifest] of workspaces.entries()) {
    const metadata = await execute(
      'cargo',
      ['metadata', '--format-version', '1', '--no-deps', '--locked', '--manifest-path', join(root, manifest)],
      { cwd: root, logs: directory, name: 'rust-metadata-' + index },
    );
    const data = /** @type {{workspace_members:string[],packages:{id:string,targets:{name:string,src_path:string}[]}[]}} */ (
        JSON.parse(metadata.stdout)
      ),
      members = new Set(data.workspace_members);
    targets.push(...data.packages.filter((pkg) => members.has(pkg.id)).flatMap((pkg) => pkg.targets));
    const result = await execute(semanticExecutable, ['lsif', manifest.slice(0, -'Cargo.toml'.length), '--exclude-vendored-libraries'], {
      cwd: root,
      logs: directory,
      name: 'rust-semantic-' + index,
    });
    const { command, args, cwd, startedAt, seconds, exitCode } = result;
    const run = { command, args, cwd, startedAt, seconds, exitCode };
    runs.push(run);
  }
  await writeJson(join(directory, 'rust-targets.json'), targets);
  const cfg = await execute('rustc', ['--print', 'cfg'], { cwd: root, logs: directory, name: 'rust-cfg' });
  return {
    runs,
    cfg: cfg.stdout.trim().split(/\r?\n/),
    engine: { version: semanticVersion, sha256: hash(await readFile(semanticExecutable)) },
  };
}

/** @typedef {{id:number,type:string,label:string,uri?:string,start?:{line:number,character:number},end?:{line:number,character:number},outV?:number,inV?:number,inVs?:number[],identifier?:string,name?:string,version?:string,positionEncoding?:string}} Lsif */
/** @param {string} root @param {string[]} sources */
export function readSemanticIndex(root, sources) {
  /** @type {Map<string,{path:string,line:number,column:number,endLine:number,endColumn:number,symbol:string,package:string}[]>} */
  const positions = new Map();
  for (const source of sources) {
    /** @type {Map<number,Lsif>} */
    const vertices = new Map();
    const documents = new Map(),
      next = new Map(),
      definitions = new Map(),
      items = new Map(),
      monikers = new Map(),
      packages = new Map();
    for (const line of source.split(/\r?\n/).filter(Boolean)) {
      const row = /** @type {Lsif} */ (JSON.parse(line));
      if (row.label === 'metaData' && row.positionEncoding !== 'utf-16')
        throw new Error('Unsupported Rust index position encoding: ' + row.positionEncoding);
      if (row.type === 'vertex') {
        if (['document', 'range', 'moniker', 'packageInformation'].includes(row.label)) vertices.set(row.id, row);
      } else if (row.label === 'contains') for (const id of row.inVs ?? []) documents.set(id, row.outV);
      else if (row.label === 'next') next.set(row.outV, row.inV);
      else if (row.label === 'textDocument/definition') definitions.set(row.outV, row.inV);
      else if (row.label === 'item') items.set(row.outV, [...(items.get(row.outV) ?? []), ...(row.inVs ?? [])]);
      else if (row.label === 'moniker') monikers.set(row.outV, row.inV);
      else if (row.label === 'packageInformation') packages.set(row.outV, row.inV);
    }
    for (const [rangeId, set] of next) {
      const range = vertices.get(rangeId),
        document = vertices.get(documents.get(rangeId));
      if (!range?.start || !document?.uri) continue;
      const path = relative(root, fileURLToPath(document.uri)).replaceAll('\\', '/');
      const key = [path.toLowerCase(), range.start.line + 1, range.start.character + 1].join(':');
      const targets = positions.get(key) ?? [];
      const moniker = vertices.get(monikers.get(set)),
        pkg = vertices.get(packages.get(monikers.get(set)));
      for (const targetId of items.get(definitions.get(set)) ?? []) {
        const target = vertices.get(targetId),
          file = vertices.get(documents.get(targetId));
        if (!target?.start || !file?.uri) continue;
        const targetPath = relative(root, fileURLToPath(file.uri)).replaceAll('\\', '/');
        targets.push({
          path: targetPath,
          line: target.start.line + 1,
          column: target.start.character + 1,
          endLine: /** @type {{line:number,character:number}} */ (target.end).line + 1,
          endColumn: /** @type {{line:number,character:number}} */ (target.end).character + 1,
          symbol: moniker?.identifier ?? '',
          package: pkg?.name ?? '',
        });
      }
      positions.set(key, [
        ...new Map(targets.map((target) => [[target.path, target.line, target.column, target.symbol].join(':'), target])).values(),
      ]);
    }
  }
  return positions;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  installSemanticEngine().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
