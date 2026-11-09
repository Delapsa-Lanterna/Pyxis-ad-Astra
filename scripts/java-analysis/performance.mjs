import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resources, reports, readJson, sha256 } from './runtime.mjs';
import { timing } from './lifecycle.mjs';

/** @param {typeof import('./verify.mjs').Session} Session @param {string} directory @param {string} java @param {string} installed @param {{name:string,root:string,files:string[],hash:string}[]} corpora @param {string[]} libraries */
export async function performanceComparison(Session, directory, java, installed, corpora, libraries) {
  const oldEngine = execFileSync('git', ['show', '1ea5fe7b70693f9976b5b02fdcd45477a4f7d1ce:src-tauri/java-analysis/resources/engine.jar']);
  const manifest = await readJson(join(installed, 'engine.json'));
  const report = [];
  for (const version of ['baseline', 'current']) {
    const engine = join(directory, version + '.jar');
    await mkdir(directory, { recursive: true });
    const bytes = version === 'baseline' ? oldEngine : await readFile(join(resources, 'engine.jar'));
    await writeFile(engine, bytes);
    const cold = [];
    const projects = [];
    for (let iteration = 0; iteration < 3; iteration++) {
      const workspace = join(directory, version + '-' + iteration);
      const configuration = join(workspace, 'configuration');
      await mkdir(configuration, { recursive: true });
      const bundleUrls = manifest.bundles.map(
        /** @param {string} bundle */ (bundle) => 'reference:' + pathToFileURL(join(installed, bundle)).href + '@start',
      );
      bundleUrls.push('reference:' + pathToFileURL(engine).href + '@start');
      await writeFile(
        join(configuration, 'config.ini'),
        'osgi.bundles=' +
          bundleUrls.join(',') +
          '\nosgi.bundles.defaultStartLevel=4\nosgi.install.area=' +
          pathToFileURL(installed + '/').href +
          '\neclipse.application=com.delapsalanterna.pyxis.javaanalysis.engine\nosgi.noShutdown=false\n',
      );
      const started = globalThis.performance.now();
      const child = spawn(
        java,
        [
          '-Xms32m',
          '-Xmx512m',
          '-Dfile.encoding=UTF-8',
          '-cp',
          join(resources, 'launcher.jar') + ';' + join(installed, 'lib/org.eclipse.osgi-3.24.300.jar'),
          'com.delapsalanterna.pyxis.javaanalysis.Launcher',
          '-configuration',
          configuration,
          '-data',
          join(workspace, 'data'),
          '-nosplash',
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      const session = new Session(child);
      const hello = await session.request('hello');
      // The process under measurement is the JVM itself in both runs.
      session.pid = child.pid;
      assert.equal(hello.value.java, 17);
      cold.push(globalThis.performance.now() - started);
      try {
        if (iteration !== 0) continue;
        for (const corpus of corpora) {
          console.log(JSON.stringify({ performanceVersion: version, mod: corpus.name }));
          const opened = await session.request('open', {
            project: corpus.name,
            sources: [corpus.root],
            classpath: libraries,
            javaHome: join(java, '../..'),
            language: '17',
          });
          const analyzed = await session.request('analyze', { project: corpus.name });
          assert.equal(analyzed.value.errors, 0);
          let selected = '';
          let text = '';
          let offset = -1;
          for (const file of corpus.files) {
            const content = await readFile(file, 'utf8');
            const match = /^\s*(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/mu.exec(content);
            if (match) {
              assert.ok(match[1]);
              if (!/\b(?:void|boolean|int|float|double|String)\s+\w+\s*\([^)]*\)\s*\{/u.test(content)) continue;
              selected = file;
              text = content;
              offset = match.index + match[0].lastIndexOf(match[1]);
              break;
            }
          }
          assert.ok(selected);
          const queryInput = { project: corpus.name, revision: 1, file: selected, offset };
          const first = await session.request('query', queryInput);
          assert.ok(first.value.node.binding);
          const hot = [];
          for (let index = 0; index < 30; index++) hot.push((await session.request('query', queryInput)).milliseconds);
          const parsed = (await session.request('parse', { source: text, version: 1, language: '17' })).value;
          const body = parsed.nodes.find(
            /** @param {{kind:string,start:number,end:number}} node */ (node) =>
              node.kind === 'MethodDeclaration' &&
              /\b(?:void|boolean|int|float|double|String)\s+\w+\s*\(/u.test(text.slice(node.start, node.end)) &&
              text.slice(node.start, node.end).includes('{'),
          );
          const bodyStart = body ? text.indexOf('{', body.start) + 1 : -1;
          const changed = bodyStart > 0 ? text.slice(0, bodyStart) + ';' + text.slice(bodyStart) : text + '\n';
          const update = await session.request('update', {
            project: corpus.name,
            expectedRevision: 1,
            files: [{ action: 'replace', file: selected, source: changed, version: 2 }],
          });
          const updatedQuery = await session.request('query', { ...queryInput, revision: 2 });
          assert.ok(updatedQuery.value.node.binding);
          let incremental;
          if (version === 'current') {
            assert.equal(updatedQuery.value.reparsedFiles, 1);
            const summary = (await session.request('analyze', { project: corpus.name })).value;
            const full = await session.request('analyze', { project: corpus.name, forceFull: true });
            assert.deepEqual(summary.diagnostics, full.value.diagnostics);
            for (const field of ['files', 'method', 'constructor', 'enumConstructor', 'methodReference'])
              assert.equal(summary[field], full.value[field]);
            incremental = {
              reparsedFiles: updatedQuery.value.reparsedFiles,
              fullFiles: full.value.reparsedFiles,
              analysisMilliseconds: updatedQuery.value.analysisMilliseconds,
              fullMilliseconds: full.milliseconds,
              actualBodyChange: bodyStart > 0,
            };
          }
          const memory = JSON.parse(
            execFileSync(
              'powershell',
              [
                '-NoProfile',
                '-Command',
                'Get-Process -Id ' + child.pid + ' | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress',
              ],
              { encoding: 'utf8', windowsHide: true },
            ),
          );
          projects.push({
            name: corpus.name,
            sourceSha256: corpus.hash,
            files: corpus.files.length,
            queryFile: relative(corpus.root, selected),
            offset,
            openMilliseconds: opened.milliseconds,
            analyzeMilliseconds: analyzed.milliseconds,
            firstQueryMilliseconds: first.milliseconds,
            hotQueryMilliseconds: timing(hot),
            updateMilliseconds: update.milliseconds,
            updatedQueryMilliseconds: updatedQuery.milliseconds,
            incremental,
            memory,
          });
          await session.request('close', { project: corpus.name });
        }
      } finally {
        await session.close();
        await writeFile(join(reports, 'performance-' + version + '-stderr.log'), session.errors, 'utf8');
      }
    }
    report.push({ version, engineSha256: sha256(bytes), coldStartMilliseconds: timing(cold), projects, exitedJvms: 3 });
  }
  return report;
}
