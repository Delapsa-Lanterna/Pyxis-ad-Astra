import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const [removedUrl, disabledUrl, enabledUrl, output, playwrightPath] = process.argv.slice(2);
const loadPackage = createRequire(playwrightPath ? pathToFileURL(playwrightPath) : import.meta.url);
const { chromium } = loadPackage('playwright');
await mkdir(output, { recursive: true });
/** @type {Record<string, unknown[]>} */
const results = { removed: [], disabled: [], enabled: [] };
for (const count of [50, 300]) {
  for (const [mode, url] of Object.entries({ removed: removedUrl, disabled: disabledUrl, enabled: enabledUrl })) {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
    const page = await context.newPage();
    const endpoint = new URL(url);
    endpoint.searchParams.set('case', `csv-${count}`);
    if (mode === 'enabled') endpoint.searchParams.set('monitor', 'on');
    await page.goto(endpoint.href);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
    await page.locator('#run').click();
    await page.locator('#status[data-complete=true]').waitFor({ timeout: 180000 });
    const report = JSON.parse(await page.locator('#status').textContent());
    const { profile } = await cdp.send('Profiler.stop');
    results[mode].push(...report);
    await writeFile(`${output}/${mode}-${count}.cpuprofile`, JSON.stringify(profile), 'utf8');
    await writeFile(`${output}/${mode}.json`, JSON.stringify(results[mode], null, 2), 'utf8');
    console.log(JSON.stringify({ mode, report }));
    await browser.close();
  }
}
