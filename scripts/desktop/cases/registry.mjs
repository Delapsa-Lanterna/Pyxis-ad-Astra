import assert from 'node:assert/strict';
import { sourceSync } from './source-sync.mjs';
import { editorLifecycle } from './editor-lifecycle.mjs';
import { editorPerformance } from './editor-performance.mjs';
import { csvPerformance } from './csv-performance.mjs';
import { sourcePerformance } from './source-performance.mjs';
/** @typedef {{launch:()=>ReturnType<typeof import('../runtime.mjs').startDesktop>,close:(app:Awaited<ReturnType<typeof import('../runtime.mjs').startDesktop>>)=>Promise<void>,fixture:Awaited<ReturnType<typeof import('../sample.mjs').prepareSample>>,check:(name:string,operation:()=>Promise<void>)=>Promise<void>,options:{mod?:string,game?:string,soak:number,count:number,rounds:number,warmup:number,phase:string,screenshots:boolean},artifacts:string,runs:import('../../shared/test-report.mjs').TestRun[]}} DesktopCase */
/** @type {Record<string,{run:(context:DesktopCase)=>Promise<Record<string,unknown>>,afterClose?:(log:string,check:DesktopCase['check'])=>Promise<void>}>} */
export const desktopCases = {
  sources: {
    run: async ({ launch, fixture, check, artifacts, options }) => {
      if (options.mod) throw Error('--mod applies to measurement suites');
      return sourceSync(await launch(), fixture, check, artifacts);
    },
    afterClose: async (log, check) =>
      check('Native WebView memory target reads back normal and low levels', async () => {
        assert.ok(log.includes('window.memory_target'));
        assert.match(log, /active=true level=0/);
        assert.match(log, /active=false level=1/);
        assert.ok(!log.includes('window.memory_target_failed'));
      }),
  },
  'code-editor': {
    run: async ({ launch, fixture, check, artifacts, options }) => {
      if (options.mod) throw Error('--mod applies to measurement suites');
      return editorLifecycle(await launch(), fixture, check, artifacts);
    },
  },
  'editor-performance': {
    run: async ({ launch, fixture, check, options, runs }) => editorPerformance(await launch(), fixture, check, options, runs),
  },
  'source-performance': {
    run: async ({ launch, fixture, check, options, artifacts, runs }) => {
      if (!options.mod || !options.game || !Number.isFinite(options.soak) || options.soak < 0)
        throw Error('Source performance requires --mod, --game and a non-negative --soak');
      return sourcePerformance({ app: await launch(), fixture: { ...fixture, game: options.game }, check, options, artifacts, runs });
    },
  },
  csv: {
    run: async (context) => {
      const result = await csvPerformance(context);
      await context.check('CSV visible-field P95 <= 200ms', async () => assert.ok(result.budget.pass, 'CSV visible-field P95 <= 200ms'));
      return result;
    },
  },
};
