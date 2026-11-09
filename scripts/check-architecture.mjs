import { collectArchitectureContext } from './architecture/facts/context.mjs';
import { checkArchitecture } from './architecture/check.mjs';
import { formatDiagnostic } from './architecture/diagnostics.mjs';
import { performance } from 'node:perf_hooks';

const timings = process.argv.includes('--timings');
const started = performance.now();
const contextTimings = new Map();
/** @param {{stage:string,durationMs:number,units?:number}} timing */
function collectContextTiming(timing) {
  const current = contextTimings.get(timing.stage) ?? { stage: timing.stage, durationMs: 0, units: 0 };
  current.durationMs += timing.durationMs;
  current.units += timing.units ?? 1;
  contextTimings.set(timing.stage, current);
}
const context = await collectArchitectureContext(process.cwd(), timings ? { onStageTiming: collectContextTiming } : undefined);
const collected = performance.now();
/** @type {{ruleId:string,durationMs:number}[]} */
const ruleTimings = [];
const diagnostics = checkArchitecture(context, timings ? { onRuleTiming: (timing) => ruleTimings.push(timing) } : undefined);
if (timings)
  console.error(
    JSON.stringify({
      contextMs: collected - started,
      contextStages: [...contextTimings.values()],
      ruleMs: ruleTimings.reduce((total, timing) => total + timing.durationMs, 0),
      totalMs: performance.now() - started,
      rules: ruleTimings,
    }),
  );
if (diagnostics.length) {
  console.error(diagnostics.map(formatDiagnostic).join('\n'));
  process.exitCode = 1;
} else console.log('Architecture check passed.');
