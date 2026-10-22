import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [phase, removedUrl, disabledUrl, enabledUrl, output, playwrightPath] = process.argv.slice(2);
const loadPackage = createRequire(playwrightPath ? pathToFileURL(playwrightPath) : import.meta.url);
const { chromium } = loadPackage('playwright');
const modes =
  phase === 'aa' ? { controlA: removedUrl, controlB: removedUrl } : { removed: removedUrl, disabled: disabledUrl, enabled: enabledUrl };
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
/** @type {Record<string, Array<{kind: string, count: number, metrics: Record<string, ReturnType<typeof summarize>>}>>} */
const results = Object.fromEntries(Object.keys(modes).map((mode) => [mode, []]));
/** @param {number[]} values */
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    min: sorted[0],
    max: sorted.at(-1),
    mean: sorted.reduce((total, value) => total + value, 0) / sorted.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}
await mkdir(output, { recursive: true });
try {
  for (const count of [50, 300]) {
    const contexts = [];
    const entries = [];
    for (const [mode, url] of Object.entries(modes)) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
      contexts.push(context);
      const page = await context.newPage();
      const endpoint = new URL(url);
      endpoint.searchParams.set('case', `csv-${count}`);
      if (mode === 'enabled') endpoint.searchParams.set('monitor', 'on');
      await page.goto(endpoint.href);
      await page.waitForFunction(() => 'retainedBenchmark' in globalThis);
      entries.push({ mode, page, values: /** @type {Record<string, number[]>} */ ({}) });
    }
    for (let iteration = 0; iteration < 30; iteration++) {
      for (let offset = 0; offset < entries.length; offset++) {
        const entry = entries[(iteration + offset) % entries.length];
        await entry.page.bringToFront();
        const values = await entry.page.evaluate(
          /** @param {{count: number, iteration: number}} input */
          ({ count, iteration }) =>
            /** @type {{retainedBenchmark: {sampleRound(kind: string, count: number, iteration: number): Promise<Record<string, number[]>>}}} */ (
              /** @type {unknown} */ (globalThis)
            ).retainedBenchmark.sampleRound('csv', count, iteration),
          { count, iteration },
        );
        for (const [name, samples] of Object.entries(values)) (entry.values[name] ??= []).push(...samples);
      }
    }
    for (const entry of entries) {
      results[entry.mode].push({
        kind: 'csv',
        count,
        metrics: Object.fromEntries(Object.entries(entry.values).map(([name, samples]) => [name, summarize(samples)])),
      });
      await writeFile(`${output}/${entry.mode}.json`, JSON.stringify(results[entry.mode], null, 2), 'utf8');
      await writeFile(`${output}/${entry.mode}-${count}-raw.json`, JSON.stringify(entry.values), 'utf8');
      console.log(JSON.stringify({ mode: entry.mode, report: results[entry.mode].at(-1) }));
    }
    await Promise.all(contexts.map((context) => context.close()));
  }
} finally {
  await browser.close();
}
