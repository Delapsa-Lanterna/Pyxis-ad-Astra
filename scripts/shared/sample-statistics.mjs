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

/** @param {Record<string, ReturnType<typeof summarize>>} before @param {Record<string, ReturnType<typeof summarize>>} after @param {'disabled' | 'enabled' | 'code'} [policy] */
export function compare(before, after, policy = 'code') {
  const ratio = policy === 'disabled' ? 0.01 : 0.1;
  const floor = policy === 'disabled' ? 1 : 5;
  return Object.keys(before).flatMap((metric) => {
    const measured = before[metric];
    if (!measured) return [];
    return /** @type {const} */ (['median', 'p95']).map((statistic) => {
      const baseline = measured[statistic];
      const actual = after[metric]?.[statistic] ?? Infinity;
      const maximum = policy === 'code' ? null : baseline + Math.max(baseline * ratio, floor);
      return { metric, statistic, baseline, actual, maximum, pass: maximum === null || actual <= maximum };
    });
  });
}
