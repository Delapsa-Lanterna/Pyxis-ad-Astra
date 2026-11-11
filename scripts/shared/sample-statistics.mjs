/** @param {number[]} values */
export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  return {
    n,
    min: sorted[0],
    max: sorted.at(-1),
    mean: sorted.reduce((sum, value) => sum + value, 0) / n,
    median: ((sorted[Math.floor((n - 1) / 2)] ?? NaN) + (sorted[Math.floor(n / 2)] ?? NaN)) / 2,
    p95: sorted[Math.ceil(n * 0.95) - 1] ?? NaN,
  };
}

/** @param {number} groups @param {number} iteration */
export const rotation = (groups, iteration) => Array.from({ length: groups }, (_, offset) => (iteration + offset) % groups);

/** @param {Record<string, ReturnType<typeof summarize>>} before @param {Record<string, ReturnType<typeof summarize>>} after */
export function compare(before, after) {
  return Object.keys(before).flatMap((metric) => {
    const measured = before[metric];
    if (!measured) return [];
    return /** @type {const} */ (['median', 'p95']).map((statistic) => {
      const baseline = measured[statistic];
      const actual = after[metric]?.[statistic];
      return { metric, statistic, baseline, actual, delta: actual === undefined ? null : actual - baseline };
    });
  });
}
