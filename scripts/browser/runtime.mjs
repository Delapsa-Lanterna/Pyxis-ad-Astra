import { chromium } from 'playwright';
import { reserveReport, scriptFingerprints } from '../shared/test-output.mjs';

/** @typedef {{page:import('playwright').Page,context:import('playwright').BrowserContext,environment:Record<string,unknown>}} BrowserEntry */
/** @typedef {{browser:import('playwright').Browser,artifacts:string,newPage:(url?:string)=>Promise<BrowserEntry>}} BrowserExecution */
/** @param {'preview'|'testbed'} kind @param {{output?:string,url?:string}} options @param {(context:BrowserExecution)=>Promise<{runs:import('../shared/test-report.mjs').TestRun[],checks:import('../shared/test-report.mjs').TestCheck[],[key:string]:unknown}>} operation */
export async function runBrowser(kind, options, operation) {
  const output = await reserveReport(options.output, 'node_modules/.cache/browser/' + kind + '/reports');
  const errors = /** @type {string[]} */ ([]);
  const scripts = await scriptFingerprints(['scripts/browser', 'scripts/shared']);
  const contexts = /** @type {Set<import('playwright').BrowserContext>} */ (new Set());
  let browser,
    result = {
      runs: /** @type {import('../shared/test-report.mjs').TestRun[]} */ ([]),
      checks: /** @type {import('../shared/test-report.mjs').TestCheck[]} */ ([]),
    },
    released = true;
  try {
    browser = await chromium.launch({
      channel: process.platform === 'win32' ? 'msedge' : undefined,
      headless: true,
      args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
    });
    const active = browser;
    /** @param {string} [url] */
    async function newPage(url = options.url ?? 'http://127.0.0.1:' + (kind === 'preview' ? '1461' : '1462')) {
      const context = await active.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
      contexts.add(context);
      context.once('close', () => contexts.delete(context));
      const page = await context.newPage();
      page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
      page.on('console', (message) => {
        if (['warning', 'error'].includes(message.type())) errors.push(message.type() + ': ' + message.text());
      });
      page.on('response', (response) => {
        if (response.status() >= 400) errors.push(response.status() + ': ' + response.url());
      });
      await page.goto(url);
      await page.waitForFunction((owner) => owner in globalThis, kind === 'preview' ? 'browserWorkspace' : 'testbed');
      const response = await page.request.get(new URL('environment', url).href);
      return {
        page,
        context,
        environment: {
          ...(await response.json()),
          browserVersion: active.version(),
          viewport: page.viewportSize(),
          dpr: await page.evaluate(() => globalThis.devicePixelRatio),
        },
      };
    }
    result = await operation({ browser, artifacts: output.artifacts, newPage });
    if ('errors' in result) errors.push(.../** @type {string[]} */ (result.errors));
  } catch (error) {
    errors.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
  } finally {
    for (const context of contexts)
      try {
        await context.close();
      } catch (error) {
        released = false;
        errors.push('Context release: ' + String(error));
      }
    contexts.clear();
    try {
      await browser?.close();
    } catch (error) {
      released = false;
      errors.push('Browser release: ' + String(error));
    }
    const pass = errors.length === 0 && released && result.runs.every((run) => run.pass) && result.checks.every((check) => check.pass);
    await output.finish({ ...result, kind, pass, errors, resourcesReleased: released, scripts });
    console.log(
      JSON.stringify({ output: output.path, pass, runs: result.runs.length, checks: result.checks.length, resourcesReleased: released }),
    );
    process.exitCode = pass ? 0 : 1;
  }
}
