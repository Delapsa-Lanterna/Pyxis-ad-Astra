import { readFile } from 'node:fs/promises';

const [removedPath, offPath, onPath] = process.argv.slice(2);
/** @typedef {{kind: string, count: number, error?: string, metrics: Record<string, Record<string, number>>}} Report */
/** @type {Report[][]} */
const [removed, off, on] = await Promise.all([removedPath, offPath, onPath].map(async (path) => JSON.parse(await readFile(path, 'utf8'))));
const failures = [],
  comparisons = [];
/** @type {[string, Report[], Report[], number, number][]} */
const modes = [
  ['disabled', removed, off, 0.01, 1],
  ['enabled', off, on, 0.1, 5],
];
for (const [label, baseline, current, ratio, floor] of modes) {
  for (const before of baseline) {
    const after = current.find((entry) => entry.kind === before.kind && entry.count === before.count);
    if (!after || after.error) {
      failures.push({ label, count: before.count, error: after?.error ?? 'missing result' });
      continue;
    }
    for (const metric of ['open', 'roundTrip', 'traverse', 'activate', 'close'])
      for (const statistic of ['median', 'p95']) {
        const original = before.metrics[metric][statistic],
          value = after.metrics[metric][statistic];
        const maximum = original + Math.max(original * ratio, floor);
        const result = {
          label,
          count: before.count,
          metric,
          statistic,
          baseline: original,
          value,
          maximum,
          deltaMs: value - original,
          deltaPercent: original ? (value / original - 1) * 100 : null,
          pass: value <= maximum,
        };
        comparisons.push(result);
        if (!result.pass) failures.push(result);
      }
  }
}
console.log(JSON.stringify({ comparisons, failures }, null, 2));
if (failures.length) process.exitCode = 1;
