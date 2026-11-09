import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { root, output, reports, readJson, writeJson, sha256, javaTool, run } from './runtime.mjs';

const { values } = parseArgs({ options: { 'dry-run': { type: 'boolean' } } });
/** @typedef {{path:string,added:number,deleted:number}} Entry */
/** @typedef {{head:string,artifacts:{path:string,bytes:number}[]}} Baseline */
/** @typedef {{name:string,command:string,args:string[],exitCode:number,milliseconds:number,stdout:string,stderr:string}} CommandRecord */
/** @typedef {{path:string,text:string,sha256:string}} DocumentBaseline */
const paths = /** @type {[string,string,string]} */ (['stage10-lines.json', 'stage10-result.json', 'stage10-delivery.zip']);
if (values['dry-run']) {
  console.log(JSON.stringify({ root, output, writes: paths.map((path) => join(output, path)), baseline: 'stage10-baseline.json' }));
} else {
  const baseline = /** @type {Baseline} */ (await readJson(join(output, 'stage10-baseline.json')));
  const git = /** @param {string[]} args */ (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(git(['rev-parse', 'HEAD']), baseline.head);
  /** @type {Entry[]} */
  const entries = git(['diff', '--numstat', baseline.head])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, deleted, path] = line.split('\t');
      assert.ok(added !== undefined && deleted !== undefined && path !== undefined);
      return { path, added: Number(added), deleted: Number(deleted) };
    });
  const lines = /** @param {string} text */ (text) => {
    const result = text.split(/\r?\n/);
    if (result.at(-1) === '') result.pop();
    return result;
  };
  for (const path of git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean))
    entries.push({ path, added: lines(await readFile(join(root, path), 'utf8')).length, deleted: 0 });
  const documents = /** @type {DocumentBaseline[]} */ (await readJson(join(output, 'stage10-document-baseline.json')));
  for (const document of documents) {
    const before = lines(document.text),
      after = lines(await readFile(join(root, document.path), 'utf8'));
    const row = new Uint32Array(after.length + 1);
    for (const original of before) {
      let previous = 0;
      for (let j = 1; j <= after.length; j++) {
        const saved = row[j] ?? 0;
        row[j] = original === after[j - 1] ? previous + 1 : Math.max(row[j] ?? 0, row[j - 1] ?? 0);
        previous = saved;
      }
    }
    const common = row[after.length] ?? 0;
    entries.push({ path: document.path, added: after.length - common, deleted: before.length - common });
  }
  for (const report of ['.zcode/plans/java-ast-engine/STAGE10-REPORT.md', '.zcode/plans/java-ast-engine/STAGE10-GROWTH.md'])
    entries.push({ path: report, added: lines(await readFile(join(root, report), 'utf8')).length, deleted: 0 });
  const production = /** @param {string} path */ (path) =>
    /^(src|src-tauri)\//.test(path) && !/(?:\/tests?\/|\.spec\.|_tests\.rs$|\/test_|\.md$|Cargo\.lock$|\/resources\/)/.test(path);
  const total = /** @param {typeof entries} items */ (items) => ({
    added: items.reduce((sum, item) => sum + item.added, 0),
    deleted: items.reduce((sum, item) => sum + item.deleted, 0),
    net: items.reduce((sum, item) => sum + item.added - item.deleted, 0),
  });
  const counts = {
    production: total(entries.filter((entry) => production(entry.path))),
    all: total(entries),
    files: entries.sort((a, b) => a.path.localeCompare(b.path)),
  };
  assert.ok(counts.production.net <= 2800);
  assert.ok(counts.all.net <= 5200);
  await writeJson(join(output, paths[0]), counts);
  const names = [
    'maven-package',
    'java-bytecode',
    'java-format',
    'rust-format',
    'rust-clippy',
    'rust-tests',
    'rust-release',
    'stage10-checker-tests',
    'stage10-current-tauri-build',
    'stage10-current-live-management',
    'stage10-current-front-tests',
    'stage10-current-main-tests',
    'stage10-current-lint',
    'stage10-current-static',
    'stage10-current-clippy',
    'stage10-typecheck',
    'stage10-script-typecheck',
    'stage10-card-tests',
    'stage10-receipt-tests',
    'stage10-current-format',
    'stage10-current-format-check',
    'stage10-current-cancellation',
    'stage10-size-current',
    'stage10-size-without-entry',
    'stage10-size-without-network',
    'stage10-restore-production-build',
  ].map((name) => name + '.json');
  const commands = /** @type {CommandRecord[]} */ (
    await Promise.all(names.map(async (name) => ({ name, ...(await readJson(join(reports, name))) })))
  );
  assert.ok(commands.every((command) => command.exitCode === 0));
  const artifacts = await Promise.all(
    [
      ...baseline.artifacts.map((item) => item.path),
      'src-tauri/java-analysis/resources/engine.jar',
      'src-tauri/java-analysis/resources/launcher.jar',
      'src-tauri/target/java-analysis/jdt-dependencies.zip',
    ].map(async (path) => {
      const bytes = await readFile(join(root, path));
      return {
        path,
        bytes: bytes.length,
        sha256: sha256(bytes),
        baselineBytes: baseline.artifacts.find((item) => item.path === path)?.bytes ?? null,
      };
    }),
  );
  const live = commands.find((command) => command.name === 'stage10-current-live-management.json');
  assert.ok(live);
  const runtimeLine = live.stdout.split(/\r?\n/).find((line) => line.startsWith('{'));
  assert.ok(runtimeLine);
  const runtime = JSON.parse(runtimeLine);
  const ui = await readJson(join(output, 'stage10-ui/result.json'));
  assert.ok(ui.passed);
  await writeJson(join(output, paths[1]), { baseline: baseline.head, commands, counts, artifacts, runtime, ui });
  const sources = git(['ls-files', 'src-tauri/java-analysis', 'scripts/java-analysis'])
    .split('\n')
    .filter((path) => Boolean(path));
  const evidence = ['maven-package', 'java-bytecode', 'java-format'].flatMap((name) =>
    ['json', 'log'].map((ext) => 'src-tauri/target/java-analysis/reports/' + name + '.' + ext),
  );
  const screenshots = (await readdir(join(output, 'stage10-ui')))
    .filter((path) => path !== 'failure.json' && path !== 'failure.png')
    .map((path) => 'src-tauri/target/java-analysis/stage10-ui/' + path);
  const files = [
    ...new Set([
      ...entries.map((entry) => entry.path),
      ...sources,
      ...evidence,
      ...screenshots,
      'src-tauri/target/java-analysis/size-audit/artifacts.json',
      'src-tauri/target/java-analysis/size-audit/source-proof.json',
      ...names.flatMap((name) => [
        'src-tauri/target/java-analysis/reports/' + name,
        'src-tauri/target/java-analysis/reports/' + name.replace('.json', '.log'),
      ]),
      ...paths.slice(0, 2).map((path) => 'src-tauri/target/java-analysis/' + path),
      'src-tauri/target/java-analysis/jdt-dependencies.zip',
      'src-tauri/target/release/java-analysis.exe',
    ]),
  ];
  await run('stage10-archive', javaTool('jar'), ['--create', '--file', join(output, paths[2]), '--no-manifest', ...files]);
  const archive = await readFile(join(output, paths[2]));
  await writeJson(join(output, 'stage10-archive.json'), {
    files: files.length,
    bytes: (await stat(join(output, paths[2]))).size,
    sha256: sha256(archive),
  });
  console.log(
    JSON.stringify({ counts: { production: counts.production, all: counts.all }, artifacts, runtime, archiveFiles: files.length }),
  );
}
