/** @typedef {{name:string,start:number,action:number,ready:number,painted:number,observed:number}} OpeningPhase */
/** @typedef {{command:string,request:string|null,start:number,response:number,audited:number}} OpeningCommand */
/** @typedef {{name:string,cat:string,ts:number,dur:number,args:{request?:string}}} NativeEvent */

export function installWorkspaceTiming() {
  const { window, document, performance, requestAnimationFrame, cancelAnimationFrame } = globalThis;
  const now = () => performance.timeOrigin + performance.now();
  /** @type {OpeningPhase[]} */
  const phases = [];
  /** @type {OpeningCommand[]} */
  const commands = [];
  /** @type {Map<OpeningPhase,number>} */
  const pending = new Map();
  function action() {
    for (const phase of phases) if (!phase.action && !phase.painted) phase.action = now();
  }
  document.addEventListener('click', action, true);
  const timing = {
    phases,
    commands,
    now,
    action,
    /** @param {string} name @param {()=>boolean} ready */
    begin(name, ready) {
      const phase = { name, start: now(), action: 0, ready: 0, painted: 0, observed: 0 };
      phases.push(phase);
      let frames = 0;
      function observe() {
        if (phase.action && ready()) {
          if (!phase.ready) phase.ready = now();
          // Two subsequent frame callbacks allow the ready DOM to be presented.
          if (frames++ === 2) {
            phase.painted = now();
            pending.delete(phase);
            return;
          }
        } else {
          phase.ready = 0;
          frames = 0;
        }
        pending.set(phase, requestAnimationFrame(observe));
      }
      pending.set(phase, requestAnimationFrame(observe));
    },
    /** @param {string} name */
    finish(name) {
      const phase = phases.findLast((phase) => phase.name === name);
      if (!phase?.painted) throw Error('Opening phase incomplete: ' + name);
      phase.observed = now();
      return phase;
    },
    stop() {
      document.removeEventListener('click', action, true);
      for (const frame of pending.values()) cancelAnimationFrame(frame);
      pending.clear();
    },
  };
  Reflect.set(window, '__openingTiming', timing);
}

/** @param {[number,number][]} intervals */
function occupied(intervals) {
  let end = -Infinity,
    total = 0;
  for (const [start, finish] of intervals.sort((left, right) => left[0] - right[0])) {
    total += Math.max(0, finish - Math.max(start, end));
    end = Math.max(end, finish);
  }
  return total;
}

/** @param {OpeningPhase[]} phases @param {OpeningCommand[]} calls @param {NativeEvent[]} events */
export function summarizeWorkspaceTiming(phases, calls, events) {
  const commands = calls.map((call) => {
    const backend = call.request ? events.find((event) => event.cat === 'backend' && event.args.request === call.request) : undefined;
    return {
      ...call,
      roundTripMs: call.response ? call.response - call.start : null,
      auditBodyMs: call.audited ? call.audited - call.response : null,
      backendMs: backend ? backend.dur / 1000 : null,
      deliveryMs: backend && call.response ? call.response - call.start - backend.dur / 1000 : null,
      backend,
    };
  });
  /** @type {Record<string,number>} */
  const metrics = {};
  for (const phase of phases.filter((phase) => phase.observed)) {
    const relevant = commands.filter((call) => call.start >= phase.action && call.response <= phase.ready && call.response > 0);
    const critical = relevant.filter((call) =>
      (phase.name === 'firstTable' ? /^query_csv_/ : /^(detect_directory|open_project_session)$/).test(call.command),
    );
    const response = Math.max(phase.action, ...critical.map((call) => call.response));
    Object.assign(metrics, {
      [phase.name + '.actionDelay']: phase.action - phase.start,
      [phase.name + '.actionToPaint']: phase.painted - phase.action,
      [phase.name + '.responseToState']: phase.ready - response,
      [phase.name + '.paintFrames']: phase.painted - phase.ready,
      [phase.name + '.driverObservation']: phase.observed - phase.painted,
      [phase.name + '.backendBusy']: occupied(
        events
          .filter((event) => event.cat === 'backend')
          .map(
            (event) =>
              /** @type {[number,number]} */ ([
                Math.max(phase.action, event.ts / 1000),
                Math.min(phase.painted, (event.ts + event.dur) / 1000),
              ]),
          )
          .filter(([start, end]) => end > start),
      ),
    });
  }
  return {
    metrics,
    phases,
    commands,
    stages: events.filter(
      (event) => event.cat === 'stage' && phases.some((phase) => event.ts / 1000 >= phase.start && event.ts / 1000 <= phase.observed),
    ),
  };
}
