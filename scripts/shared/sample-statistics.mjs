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
