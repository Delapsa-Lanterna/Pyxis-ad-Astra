import assert from 'node:assert/strict';
import { sourceSync } from './source-sync.mjs';
import { editorLifecycle } from './editor-lifecycle.mjs';
import { editorPerformance } from './editor-performance.mjs';
import { immersivePerformance } from './immersive-performance.mjs';
import { csvPerformance } from './csv-performance.mjs';
import { sourcePerformance } from './source-performance.mjs';
import { javaQueries } from './java-queries.mjs';
import { sourceActions, verifyJavaLogs } from './source-actions.mjs';
import { pickerPerformance } from './picker-performance.mjs';
import { workspaceOpening } from './workspace-opening.mjs';
/** @typedef {{launch:()=>ReturnType<typeof import('../runtime.mjs').startDesktop>,close:(app:Awaited<ReturnType<typeof import('../runtime.mjs').startDesktop>>)=>Promise<void>,fixture:Awaited<ReturnType<typeof import('../sample.mjs').prepareSample>>,check:(name:string,operation:()=>Promise<void>)=>Promise<void>,options:{mod?:string,game?:string,soak:number,count:number,bytes:number,shape?:string,rounds:number,warmup:number,phase:string,screenshots:boolean},artifacts:string,runs:import('../../shared/test-report.mjs').TestRun[]}} DesktopCase */
/** @type {Record<string,{run:(context:DesktopCase)=>Promise<Record<string,unknown>>,afterClose?:(log:string,check:DesktopCase['check'])=>Promise<void>}>} */
export const desktopCases = {
  'workspace-opening': { run: workspaceOpening },
  'source-actions': { run: sourceActions, afterClose: verifyJavaLogs },
  weapons: { run: (context) => pickerPerformance(context, 'weapons') },
  wings: { run: (context) => pickerPerformance(context, 'wings') },
  hullmods: { run: (context) => pickerPerformance(context, 'hullmods') },
  'java-queries': { run: javaQueries },
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
  'immersive-performance': { run: immersivePerformance },
  'source-performance': {
    run: async ({ launch, fixture, check, options, artifacts, runs }) => {
      if (!options.mod || !options.game || !Number.isFinite(options.soak) || options.soak < 0)
        throw Error('Source performance requires --mod, --game and a non-negative --soak');
      return sourcePerformance({ app: await launch(), fixture: { ...fixture, game: options.game }, check, options, artifacts, runs });
    },
  },
  csv: { run: csvPerformance },
};
