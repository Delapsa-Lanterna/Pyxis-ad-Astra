import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { cpus } from 'node:os';
import { stores, invoke } from '../config.mjs';
import { openMod, until, delay } from '../runtime.mjs';
import { startProcessSampler } from '../process-sampler.mjs';
import { summarize } from '../../shared/sample-statistics.mjs';
import { createTestRun } from '../../shared/test-report.mjs';
import { fileHash } from '../../shared/test-output.mjs';
import { connectDesktopCdp } from '../cdp-client.mjs';

/** @typedef {{kind:string,state?:string,waiting?:boolean,root?:string,modRoot?:string,sessionUpdates?:number,at:number}} SourceEvent */
/** @typedef {{kind:string,sessions:number,round:number,milliseconds:number,afterWriteMs:number,published:number,queries:Record<string,number>}} SourceSample */
/** @param {{app:Awaited<ReturnType<typeof import('../runtime.mjs').startDesktop>>,fixture:Awaited<ReturnType<typeof import('../sample.mjs').prepareSample>>,check:(name:string,operation:()=>Promise<void>)=>Promise<void>,options:{rounds:number,warmup:number,soak:number},artifacts:string,runs:import('../../shared/test-report.mjs').TestRun[]}} context */
export async function sourcePerformance({ app, fixture, check, options, artifacts, runs }) {
  const { main: page } = app;
  await page.evaluate(stores + '.get("settings").setWatchFileChanges(true)');
  await until(() => page.evaluate('(async()=> (await ' + invoke + '("read_settings")).value.watchFileChanges)()'), 'file watching enabled');
  let evaluate = page.evaluate.bind(page);
  let send = app.session.send.bind(app.session);
  /** @type {Awaited<ReturnType<typeof connectDesktopCdp>>|undefined} */
  let cdp;
  const diagnostics = /** @type {string[]} */ ([]);
  const table = join(fixture.mod, 'data/hulls/ship_data.csv');
  const descriptor = fixture.descriptor;
  const originalCsv = await readFile(table, 'utf8');
  const originalInfo = await readFile(descriptor, 'utf8');
  const first = originalCsv.split('\n').find((line, index) => index > 0 && line.split(',')[1]?.trim() && !line.startsWith('#'));
  assert.ok(first, 'The source performance sample has a ship row');
  const sourceRow = first;
  const header = originalCsv.slice(0, originalCsv.indexOf('\n')).split(','),
    columns = first.split(','),
    nameIndex = header.indexOf('name');
  assert.ok(nameIndex >= 0 && columns[nameIndex]);
  const sourceInfoHash = await fileHash(join(fixture.source, 'mod_info.json'));
  const sourceCsvHash = await fileHash(join(fixture.source, 'data/hulls/ship_data.csv'));
  /** @type {SourceSample[]} */
  const samples = [];
  /** @type {Record<string,ReturnType<Awaited<ReturnType<typeof startProcessSampler>>['statistics']>>} */
  const processes = {};
  /** @type {Record<string,Record<string,number>>} */
  const heaps = {};
  /** @type {string[]} */
  const extraSessions = [];
  const cases = ['descriptor', 'csv', 'same-content', 'burst-20', 'rescan', 'changed-rescan'];
  const state = stores + '.get("csv-editor").getCsvModState(window.__desktopTarget.modRoot).documents.ships';
  let csv = originalCsv;
  let info = originalInfo;
  await app.session.send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 860, deviceScaleFactor: 1.5, mobile: false });
  await app.session.send('Performance.enable');
  await page.evaluate(`(()=>{
    const api=window.__TAURI_INTERNALS__,fetch=window.fetch;
    window.__sourceAudit={events:[],queries:{}};
    window.fetch=function(input,...args){
      const command=String(input).split('/').at(-1);
      if(command.startsWith('query_'))window.__sourceAudit.queries[command]=(window.__sourceAudit.queries[command]??0)+1;
      if(command==='query_csv_source_options'){
        const payload=JSON.parse(args[0].body).payload;
        const key=command+':'+payload.source;
        window.__sourceAudit.queries[key]=(window.__sourceAudit.queries[key]??0)+1;
      }
      return fetch.call(this,input,...args);
    };
    for(const [key,callback]of api.callbacks)api.callbacks.set(key,function(data){
      const e=data?.message;
      if(e&&['sourceStatus','saved','waiting'].includes(e.kind))window.__sourceAudit.events.push({kind:e.kind,state:e.state,root:e.root,waiting:e.waiting,modRoot:e.event?.modRoot??e.modRoot,sessionUpdates:e.event?.result?.sessionUpdates?.length,at:performance.now()});
      return callback(data);
    });
  })()`);
  const sampler = await startProcessSampler(app.environment.nativeDesktop.pid);
  /** @param {string} key @param {()=>Promise<void>} operation */
  async function phase(key, operation) {
    console.log('PHASE ' + key);
    await sampler.phase(key);
    try {
      await operation();
    } finally {
      await delay(240);
      processes[key] = sampler.statistics(key);
      const metrics = await send('Performance.getMetrics');
      heaps[key] = Object.fromEntries(
        metrics.metrics
          .filter((item) => ['JSHeapUsedSize', 'JSHeapTotalSize', 'Documents', 'Nodes', 'JSEventListeners'].includes(item.name))
          .map((item) => [item.name, item.value]),
      );
      await sampler.phase('between');
    }
  }
  try {
    await phase('empty-idle', () => delay(15000));
    const manifest = await openMod(page, fixture.mod, fixture.game, 'ships');
    await until(
      () => page.evaluate(state + '.rowOrder.length>0 && document.querySelectorAll("[data-row-key]").length>0'),
      'source table ready',
    );
    cdp = await connectDesktopCdp(app.config.endpoint);
    cdp.on('Runtime.exceptionThrown', (detail) => diagnostics.push(JSON.stringify(detail)));
    cdp.on('Runtime.consoleAPICalled', (detail) => {
      if (detail.type === 'error' || detail.type === 'warning') diagnostics.push(JSON.stringify(detail));
    });
    await cdp.send('Runtime.enable');
    await app.disconnectDriver();
    evaluate = /** @type {typeof page.evaluate} */ (cdp.evaluate);
    send = /** @type {typeof app.session.send} */ (cdp.send);
    // Emulation belongs to its CDP session and ends when the opening driver disconnects.
    await send('Emulation.setDeviceMetricsOverride', { width: 1360, height: 860, deviceScaleFactor: 1.5, mobile: false });
    const viewport = await evaluate(
      '({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,layoutWidth:document.documentElement.clientWidth,layoutHeight:document.documentElement.clientHeight})',
    );
    assert.deepEqual(viewport, { width: 1360, height: 860, dpr: 1.5, layoutWidth: 1360, layoutHeight: 860 });
    await send('Performance.enable');
    await evaluate(invoke + '("plugin:window|set_focus",{label:"main"})');
    await delay(3000);
    /** @param {string} kind @param {number} count @param {number} round */
    async function measure(kind, count, round) {
      const marker = 'SourcePerformance_' + count + '_' + round + '_' + kind;
      await evaluate('window.__sourceAudit.events=[];window.__sourceAudit.queries={}');
      const started = performance.now();
      let expected = 'true';
      if (kind === 'descriptor' || kind === 'changed-rescan') {
        info = originalInfo.replace(/"name"\s*:\s*"[^"]*"/, '"name":' + JSON.stringify(marker));
        await writeFile(descriptor, info, 'utf8');
        expected = stores + '.get("project").getManifest(window.__desktopTarget.modRoot).modInfo.name===' + JSON.stringify(marker);
      } else if (kind === 'csv' || kind === 'burst-20') {
        const writes = kind === 'csv' ? 1 : 20;
        for (let index = 0; index < writes; index++) {
          const next = [...columns];
          next[nameIndex] = index === writes - 1 ? marker : marker + '_' + index;
          csv = originalCsv.replace(sourceRow, next.join(','));
          await writeFile(table, csv, 'utf8');
          if (index < writes - 1) await delay(10);
        }
        expected =
          'Object.values(' +
          state +
          '.rows).some(row=>row.data.name===' +
          JSON.stringify(marker) +
          ') && document.querySelector(".table-panel").textContent.includes(' +
          JSON.stringify(marker) +
          ')';
      } else if (kind === 'same-content') await writeFile(table, csv, 'utf8');
      const written = performance.now();
      if (kind === 'rescan' || kind === 'changed-rescan')
        await evaluate(invoke + '("retry_source_watch",{root:' + JSON.stringify(manifest.modRoot) + '})');
      /** @type {{events:SourceEvent[],queries:Record<string,number>}} */
      const result = await evaluate(`(async()=>{
        const started=performance.now();
        while(performance.now()-started<30000){
          const sync=${stores}.get('project-sync'),audit=window.__sourceAudit;
          const key=path=>String(path).split(String.fromCharCode(92)).join('/').replace('//?/','').toLowerCase();
          if(audit.events.some(e=>(e.kind==='sourceStatus'&&e.state==='watching'&&e.root===window.__desktopTarget.modRoot)||(e.kind==='waiting'&&e.waiting===false&&key(e.modRoot)===key(window.__desktopTarget.modRoot)))&&!sync.isWaiting(window.__desktopTarget.modRoot)&&sync.pending.length===0&&(${expected})){
            await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
            return audit;
          }
          await new Promise(r=>setTimeout(r,5));
        }
        throw Error('Source performance refresh timeout: '+JSON.stringify(window.__sourceAudit));
      })()`);
      const saved = result.events.filter((event) => event.kind === 'saved' && event.modRoot === manifest.modRoot);
      if (kind === 'same-content') assert.equal(saved.length, 0);
      else if (kind !== 'rescan') assert.ok(saved.length > 0);
      if (saved.length) assert.equal(saved.at(-1)?.sessionUpdates, count);
      samples.push({
        kind,
        sessions: count,
        round,
        milliseconds: performance.now() - started,
        afterWriteMs: performance.now() - written,
        published: saved.length,
        queries: result.queries,
      });
      let run = runs.find((run) => run.parameters.sessions === count && run.parameters.operation === kind);
      if (!run) {
        run = createTestRun({
          scenario: 'sources',
          parameters: { sessions: count, operation: kind },
          units: { sessions: 'sessions' },
          execution: 'native',
          completion: '来源变化完成正式接纳；记录通知和查询次数',
          environment: { ...app.environment, ...viewport },
          warmup: options.warmup,
          rounds: options.rounds,
          samples: [],
          resources: { processes, heaps, released: false },
        });
        runs.push(run);
      }
      run.samples.push({
        iteration: round,
        phase: round < 0 ? 'warmup' : round < options.rounds ? 'measurement' : 'soak',
        metrics: { milliseconds: performance.now() - started, afterWrite: performance.now() - written, published: saved.length },
        assertions: [],
      });
    }
    for (const count of [1, 2]) {
      if (count === 2) {
        const next = await evaluate(
          invoke + '("open_project_session",{payload:' + JSON.stringify({ modRoot: fixture.mod, starsectorRoot: fixture.game }) + '})',
        );
        extraSessions.push(next.sessionId);
        await evaluate(
          invoke +
            '("query_csv_table_index",{payload:' +
            JSON.stringify({
              sessionId: next.sessionId,
              table: 'ships',
              initialCount: 50,
              search: null,
              searchField: 'id-name',
              validationColumns: [],
            }) +
            '})',
        );
      }
      await phase(count + '-idle', () => delay(15000));
      for (const kind of cases)
        await phase(count + '-' + kind, async () => {
          for (let round = -options.warmup; round < options.rounds; round++) await measure(kind, count, round);
        });
    }
    await phase('soak', async () => {
      const started = performance.now();
      for (let round = options.rounds; performance.now() - started < options.soak * 1000; round++) {
        await measure(cases[round % cases.length] ?? 'csv', 2, round);
        if (round % 30 === 0) {
          const metrics = await send('Performance.getMetrics');
          heaps['soak-' + round] = Object.fromEntries(
            metrics.metrics
              .filter((item) => ['JSHeapUsedSize', 'Documents', 'Nodes', 'JSEventListeners'].includes(item.name))
              .map((item) => [item.name, item.value]),
          );
        }
      }
    });
    await phase('final-idle', () => delay(15000));
    await evaluate(invoke + '("plugin:window|minimize",{label:"main"})');
    await phase('background-idle', () => delay(15000));
    await check('Source performance rounds completed with no source issues', async () => {
      assert.ok(samples.length >= options.rounds * cases.length * 2);
      assert.equal(await evaluate(stores + '.get("project-sync").sourceIssues.length'), 0);
      assert.deepEqual(diagnostics, []);
    });
    await check('The measurement connection retains the requested viewport through the workload', async () => {
      assert.deepEqual(
        await evaluate(
          '({width:innerWidth,height:innerHeight,dpr:devicePixelRatio,layoutWidth:document.documentElement.clientWidth,layoutHeight:document.documentElement.clientHeight})',
        ),
        viewport,
      );
    });
    await check('Original source descriptor and CSV retain their SHA-256', async () => {
      assert.equal(await fileHash(join(fixture.source, 'mod_info.json')), sourceInfoHash);
      assert.equal(await fileHash(join(fixture.source, 'data/hulls/ship_data.csv')), sourceCsvHash);
    });
    const statistics = Object.fromEntries(
      [1, 2].flatMap((count) =>
        cases.map((kind) => {
          const rows = samples.filter((row) => row.sessions === count && row.kind === kind && row.round >= 0 && row.round < options.rounds);
          return [
            count + '-' + kind,
            {
              milliseconds: summarize(rows.map((row) => row.milliseconds)),
              afterWriteMs: summarize(rows.map((row) => row.afterWriteMs)),
              published: rows.reduce((sum, row) => sum + row.published, 0),
              queries: rows.reduce((totals, row) => {
                for (const [name, count] of Object.entries(row.queries)) totals[name] = (totals[name] ?? 0) + count;
                return totals;
              }, /** @type {Record<string,number>} */ ({})),
            },
          ];
        }),
      ),
    );
    await writeFile(join(artifacts, 'process-samples.json'), JSON.stringify(sampler.samples) + '\n', 'utf8');
    const chunks = /** @type {string[]} */ ([]);
    cdp.on('HeapProfiler.addHeapSnapshotChunk', ({ chunk }) => chunks.push(String(chunk)));
    await send('HeapProfiler.takeHeapSnapshot');
    await writeFile(join(artifacts, 'completed.heapsnapshot'), chunks.join(''), 'utf8');
    return {
      environment: { ...app.environment, ...viewport, cpu: cpus()[0]?.model, ...sampler.environment },
      sample: { source: fixture.source, tables: manifest.entitySummaries },
      samples,
      statistics,
      processes,
      heaps,
    };
  } finally {
    await sampler.close();
    for (const sessionId of extraSessions)
      await evaluate(invoke + '("close_project_session",{payload:{sessionId:' + JSON.stringify(sessionId) + '}})');
    await cdp?.close();
  }
}
