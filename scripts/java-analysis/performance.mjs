import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { Session } from './session.mjs';
import { versions } from './runtime.mjs';
import { semantic } from './incremental.mjs';
import { summarize, rotation, compare } from '../shared/sample-statistics.mjs';

/** @param {string} config @param {string} java @param {{name:string,root:string,files:string[],hash:string}[]} corpora @param {string[]} libraries @param {{warmup:number,rounds:number}} options */
export async function performanceComparison(config, java, corpora, libraries, options) {
  const cold = [];
  for (let iteration = 0; iteration < 3; iteration++) {
    const began = performance.now();
    const session = await Session.start(config, java);
    try {
      await session.hello();
      cold.push(performance.now() - began);
    } finally {
      await session.close();
    }
  }
  const session = await Session.start(config, java);
  const projects = [];
  try {
    await session.hello();
    for (const corpus of corpora) {
      let selected = '',
        text = '',
        offset = -1,
        bodyStart = -1;
      for (const file of corpus.files) {
        const source = await readFile(file, 'utf8');
        const match = /^\s*(?:public\s+)?(?:abstract\s+)?class\s+(\w+)/mu.exec(source);
        if (!match?.[1]) continue;
        const syntax = (await session.request('parse', { source, version: 1 })).value;
        const body = syntax.nodes.find(
          /** @param {{kind:string,start:number,end:number}} node */ (node) =>
            node.kind === 'MethodDeclaration' &&
            /\b(?:void|boolean|int|float|double|String)\s+\w+\s*\(/u.test(source.slice(node.start, node.end)) &&
            source.slice(node.start, node.end).includes('{'),
        );
        if (!body) continue;
        selected = file;
        text = source;
        offset = match.index + match[0].lastIndexOf(match[1]);
        bodyStart = text.indexOf('{', body.start) + 1;
        break;
      }
      assert.ok(selected && bodyStart > 0);
      const modes = ['incremental', 'full'];
      const states =
        /** @type {{mode:string,project:string,revision:number,samples:{iteration:number,phase:string,update:number,query:number,reparsedFiles:number,invalidatedFiles:number}[],openMilliseconds:number,analyzeMilliseconds:number}[]} */ ([]);
      for (const mode of modes) {
        const project = corpus.name + '-' + mode;
        const opened = await session.request('open', {
          project,
          sources: [corpus.root],
          classpath: libraries,
          javaHome: join(java, '../..'),
          language: versions.language,
        });
        const analyzed = await session.request('analyze', { project });
        assert.equal(analyzed.value.errors, 0);
        states.push({
          mode,
          project,
          revision: 1,
          samples:
            /** @type {{iteration:number,phase:string,update:number,query:number,reparsedFiles:number,invalidatedFiles:number}[]} */ ([]),
          openMilliseconds: opened.milliseconds,
          analyzeMilliseconds: analyzed.milliseconds,
        });
      }
      const order = [];
      for (let iteration = 0; iteration < options.warmup + options.rounds; iteration++) {
        const phase = iteration < options.warmup ? 'warmup' : 'measurement';
        const changed = text.slice(0, bodyStart) + ';'.repeat((iteration % 2) + 1) + text.slice(bodyStart);
        const results = [];
        for (const index of rotation(states.length, iteration)) {
          const state = states[index];
          assert.ok(state);
          const update = await session.request('update', {
            project: state.project,
            expectedRevision: state.revision,
            files: [{ action: 'replace', file: selected, source: changed, version: iteration + 2 }],
          });
          state.revision++;
          let fullMilliseconds = 0;
          if (state.mode === 'full')
            fullMilliseconds = (await session.request('analyze', { project: state.project, forceFull: true })).milliseconds;
          const query = await session.request('query', { project: state.project, revision: state.revision, file: selected, offset });
          assert.ok(query.value.node.binding);
          const summary = (await session.request('analyze', { project: state.project })).value;
          results.push({ query: semantic(query.value), summary: semantic(summary) });
          state.samples.push({
            iteration,
            phase,
            update: update.milliseconds,
            query: fullMilliseconds + query.milliseconds,
            reparsedFiles: query.value.reparsedFiles,
            invalidatedFiles: query.value.invalidatedFiles,
          });
          order.push({ iteration, phase, mode: state.mode });
        }
        assert.deepEqual(results[0], results[1]);
      }
      const hot = [];
      const state = states[0];
      assert.ok(state);
      for (let iteration = 0; iteration < options.warmup + options.rounds; iteration++) {
        const query = await session.request('query', { project: state.project, revision: state.revision, file: selected, offset });
        hot.push({ iteration, phase: iteration < options.warmup ? 'warmup' : 'measurement', milliseconds: query.milliseconds });
      }
      const measurements = states.map((state) => {
        const samples = state.samples.filter((sample) => sample.phase === 'measurement');
        return {
          ...state,
          metrics: { update: summarize(samples.map((sample) => sample.update)), query: summarize(samples.map((sample) => sample.query)) },
        };
      });
      const memory = JSON.parse(
        execFileSync(
          'powershell',
          [
            '-NoProfile',
            '-Command',
            'Get-Process -Id ' + session.pid + ' | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress',
          ],
          { encoding: 'utf8', windowsHide: true },
        ),
      );
      const [incremental, full] = measurements;
      assert.ok(incremental && full);
      projects.push({
        name: corpus.name,
        sourceSha256: corpus.hash,
        files: corpus.files.length,
        queryFile: relative(corpus.root, selected),
        offset,
        measurements,
        order,
        comparisons: compare(incremental.metrics, full.metrics),
        hot: { samples: hot, ...summarize(hot.filter((sample) => sample.phase === 'measurement').map((sample) => sample.milliseconds)) },
        memory,
        semanticMatches: options.warmup + options.rounds,
      });
      for (const state of states) await session.request('close', { project: state.project });
      console.log(JSON.stringify({ performance: corpus.name, rounds: options.rounds, semanticMatches: options.warmup + options.rounds }));
    }
  } finally {
    await session.close();
  }
  return [{ coldStart: { samples: cold, ...summarize(cold) }, projects, exitedJvms: 4 }];
}
