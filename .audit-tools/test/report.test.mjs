import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { cleanReports, environment, hash, publish, runtimeRoot, writeJson } from '../src/runtime.mjs';
import { serveReport as serve } from './report-server.mjs';
import { renderReport } from '../src/report.mjs';

/** @returns {import('../src/model.mjs').Report} */
function report() {
  /** @type {import('../src/model.mjs').File[]} */
  const files = Array.from({ length: 260 }, (_, index) => ({
    path: `src/目录/file-${index}.ts`,
    hash: 'hash',
    bytes: 20,
    lines: 2,
    role: 'production',
    text: `export const value = ${index};\n`,
    ownership: {
      owner: index % 2 ? 'alpha' : 'beta',
      status: 'declared',
      candidates: [
        {
          module: index % 2 ? 'alpha' : 'beta',
          relation: 'owns',
          evidence: [{ path: '.zcode/modules/alpha.md', line: 1, text: '</script> 中文', parser: 'module-document' }],
        },
      ],
    },
  }));
  const first = /** @type {import('../src/model.mjs').File} */ (files[0]);
  for (const status of /** @type {const} */ (['candidate', 'conflict', 'unmatched']))
    files.push({
      ...first,
      path: `src/${status}.ts`,
      ownership: {
        status,
        owner: null,
        candidates:
          status === 'unmatched'
            ? []
            : [
                ...(status === 'conflict' ? ['alpha', 'beta'] : ['alpha']).map((module) => ({
                  module,
                  relation: status === 'conflict' ? 'owns' : 'consumes',
                  evidence: [{ path: '.zcode/modules/alpha.md', line: 1, text: '消费唯一实例', parser: 'module-document' }],
                })),
              ],
      },
    });
  files.push({
    ...first,
    path: '.zcode/modules/alpha.md',
    role: 'document',
    text: '# 模块甲\n',
    ownership: { ...first.ownership, owner: 'alpha' },
  });
  files.push({
    ...first,
    path: 'src/shared/public.rs',
    text: 'pub struct Shape;\n',
    ownership: {
      status: 'shared',
      owner: null,
      candidates: [],
      sharedEvidence: [{ path: 'src/shared/public.rs', line: 1, text: 'Shared directory', parser: 'shared-directory' }],
    },
  });
  files.push({ ...first, path: 'src/consumer.rs', text: 'struct Consumer { data: crate::public::Shape }\n' });
  return {
    schemaVersion: 5,
    run: { head: 'test-head', digest: 'digest', completedAt: 'fixture', root: '/fixture' },
    modules: [
      { id: 'alpha', title: '模块甲', path: '.zcode/modules/alpha.md', references: [] },
      { id: 'beta', title: '模块乙', path: '.zcode/modules/beta.md', references: [] },
    ],
    files,
    edges: [
      ...files.slice(1).map((file, index) => ({
        source: /** @type {import('../src/model.mjs').File} */ (files[index]).path,
        target: file.path,
        kind: index % 2 ? 'type' : 'runtime',
        line: 1,
        symbols: 'value',
        parser: 'fixture',
      })),
      {
        source: 'src/consumer.rs',
        target: 'src/shared/public.rs',
        kind: 'rust-type',
        dependencyClass: 'usage',
        line: 1,
        column: 25,
        targetLine: 1,
        symbols: 'Shape → fixture::public::Shape',
        parser: 'tree-sitter-rust scoped types',
        conditional: '#[cfg(feature = "drawing")]',
        testOnly: false,
      },
      {
        source: 'src/shared/public.rs',
        target: 'src/consumer.rs',
        kind: 'rust-import',
        dependencyClass: 'structure',
        line: 1,
        targetLine: 1,
        symbols: 'fixture structure',
        parser: 'fixture',
      },
    ],
    declarations: [{ path: first.path, line: 1, column: 1, name: 'value', scope: 'module', kind: 'value', text: '0' }],
    events: [],
    issues: Array.from({ length: 205 }, (_, index) => ({
      kind: 'location',
      path: /** @type {import('../src/model.mjs').File} */ (files[index % files.length]).path,
      line: 1,
      parser: 'fixture',
      message: `定位样例 ${index}`,
    })),
    cycles: [],
    rust: {
      symbols: [
        { id: 'crate', label: 'crate', kind: 'crate', locations: [] },
        { id: 'crate::module', label: 'module', kind: 'mod', locations: [] },
      ],
      relations: [
        { source: 'crate', target: 'crate::module', kind: 'owns' },
        { source: 'crate', target: 'crate::module', kind: 'uses' },
      ],
    },
    exploration: null,
  };
}

/** @param {string} root @param {string} screenshot */
async function browserCheck(root, screenshot) {
  const server = await serve(root, 0, { runtimeRoot: join(root, '..', 'runtime') });
  process.env.PLAYWRIGHT_BROWSERS_PATH = environment().PLAYWRIGHT_BROWSERS_PATH;
  const { chromium } = await import('playwright');
  let browser;
  /** @type {string[]} */
  const errors = [];
  /** @type {string[]} */
  const requests = [];
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(`http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}/`);
    await page.waitForFunction(() => document.getElementById('graphStatus').textContent.includes('组模块关系'));
    assert.ok(await page.locator('#graph canvas').count());
    assert.ok(await page.locator('#entries button').count());
    assert.ok(await page.locator('#fileTable tbody tr').count());
    assert.ok(await page.locator('#audit-data').evaluate((element) => new TextEncoder().encode(element.textContent).length < 100));
    assert.equal(await page.locator('#basis').inputValue(), 'usage');
    assert.equal(await page.locator('#relationScope').inputValue(), 'source');
    assert.equal(await page.locator('#entries button').count(), 2);
    assert.equal(await page.locator('#graph .vis-network').count(), 1);
    const canvas = page.locator('#graph canvas');
    const bounds = await canvas.boundingBox();
    assert.ok(bounds);
    const nodePoint = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height - 80 };
    await page.mouse.move(nodePoint.x, nodePoint.y);
    await page.locator('#graph .vis-tooltip').waitFor({ state: 'visible' });
    assert.ok((await page.locator('#graph .vis-tooltip').textContent())?.includes('模块'));
    await page.screenshot({ path: screenshot.replace('.png', '-hover-light.png') });
    await page.mouse.down();
    await page.mouse.move(nodePoint.x + 45, nodePoint.y - 25, { steps: 12 });
    await page.screenshot({ path: screenshot.replace('.png', '-during-drag.png') });
    await page.mouse.up();
    await page.mouse.move(10, 10);
    const module = page.locator('#entries button').filter({ hasText: '模块甲' }).first();
    await module.click();
    await page.waitForFunction(() => document.querySelector('#detail')?.textContent.includes('上下游关系'));
    assert.ok((await page.locator('#detail').textContent())?.includes('模块乙'));
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: screenshot.replace('.png', '-selected-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('#overview').click();
    await page
      .locator('#sectionTabs button')
      .filter({ hasText: /^文件$/ })
      .click();
    await page.locator('#fileSearch').fill('file-0.ts');
    await page.waitForFunction(() => document.querySelector('#fileTable')?.textContent.includes('file-0.ts'));
    await page.screenshot({ path: screenshot.replace('.png', '-desktop.png'), fullPage: false });
    await page.locator('#fileTable tbody button').first().click();
    await page.locator('#detail pre .source-line').first().waitFor();
    await page.locator('#sectionTabs button').filter({ hasText: '待核线索' }).click();
    await page.locator('#issueCategories button').first().click();
    await page.waitForFunction(() => document.querySelector('#issues')?.textContent.includes('定位样例'));
    assert.ok((await page.locator('#issues details').count()) <= 100);
    assert.equal(await page.locator('#exports a').count(), 26);
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 1180, height: 850 });
    await page.locator('#toggleNav').click();
    assert.equal(await page.locator('#sidePanel').isVisible(), true);
    assert.equal(await page.locator('#sidePanel #closePanels').count(), 1);
    assert.equal(await page.locator('#search').evaluate((element) => element === document.activeElement), true);
    await page.locator('#search').fill('模块乙');
    assert.equal(await page.locator('#entries button').count(), 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#sidePanel').isVisible(), false);
    assert.equal(await page.locator('#toggleNav').evaluate((element) => element === document.activeElement), true);
    await page.locator('#toggleNav').click();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.locator('#sidePanel').evaluate((element) => element.contains(document.activeElement)), true);
    await page.mouse.click(1170, 800);
    assert.equal(await page.locator('#sidePanel').isVisible(), false);
    await page.locator('#toggleNav').click();
    await page.locator('#entries button').first().click();
    assert.equal(await page.locator('#sidePanel').isVisible(), false);
    await page.locator('#exportMenu summary').click();
    assert.equal(await page.locator('#exportMenu').getAttribute('open'), '');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#exportMenu').getAttribute('open'), null);
    assert.equal(await page.locator('#entries [aria-pressed="true"]').count(), 1);
    await page.locator('#graph canvas').click({ position: { x: 5, y: 5 } });
    assert.equal(await page.locator('#entries [aria-pressed="true"]').count(), 0);
    await page.waitForFunction(() => document.querySelector('#detail')?.textContent.includes('选择模块或关系'));
    await page.locator('#toggleDetail').click();
    assert.equal(await page.locator('#sidePanel[data-panel="detail"]').isVisible(), true);
    await page.locator('#closePanels').click();
    assert.equal(await page.locator('#toggleDetail').evaluate((element) => element === document.activeElement), true);
    await page.setViewportSize({ width: 620, height: 900 });
    await page.locator('#toggleNav').click();
    assert.equal(await page.locator('#sidePanel[data-panel="navigation"]').isVisible(), true);
    await page.screenshot({ path: screenshot.replace('.png', '-drawer.png'), fullPage: true });
    await page.locator('#closePanels').click();
    assert.equal(await page.locator('#sidePanel').isVisible(), false);
    await page.screenshot({ path: screenshot, fullPage: true });
    assert.deepEqual(errors, []);
    assert.ok(requests.every((url) => url.startsWith('http://127.0.0.1:')));
  } finally {
    if (browser) await browser.close();
    await new Promise((done) => server.close(done));
  }
}

test('lightweight report supports APIs, real browser graphs, evidence, filtering and responsive panels', async () => {
  await mkdir(join(runtimeRoot, 'work'), { recursive: true });
  const root = await mkdtemp(join(runtimeRoot, 'work/report '));
  await mkdir(join(runtimeRoot, 'logs/check'), { recursive: true });
  try {
    const data = report();
    await mkdir(join(root, 'ready'));
    await renderReport(data, join(root, 'ready'));
    const html = await readFile(join(root, 'ready/index.html'), 'utf8');
    assert.ok(!/<script[^>]+src=/.test(html));
    assert.ok((await readFile(join(root, 'ready/overview.json'), 'utf8')).length < 1000000);
    assert.ok((await readFile(join(root, 'ready/graph-index.json'), 'utf8')).length < 500000);
    assert.ok(
      (await readFile(join(root, 'ready/files/' + hash('src/目录/file-0.ts') + '.json'), 'utf8')).includes('export const value = 0'),
    );
    await mkdir(join(root, 'output'));
    await writeJson(join(root, 'output/current.json'), { id: 'fixture' });
    await rename(join(root, 'ready'), join(root, 'output/fixture'));
    const csv = await readFile(join(root, 'output/fixture/ownership.csv'), 'utf8');
    assert.ok(csv.includes('"status","owner"'));
    assert.ok(csv.includes('"candidate",""'));
    const modules = await readFile(join(root, 'output/fixture/module-dependencies.csv'), 'utf8');
    assert.ok(modules.includes('"beta","alpha"'));
    assert.ok(!modules.includes('src/candidate.ts'));
    assert.ok(!modules.includes('src/conflict.ts'));
    assert.ok(!modules.includes('src/unmatched.ts'));
    const complete = await readFile(join(root, 'output/fixture/dependencies.csv'), 'utf8');
    const usage = await readFile(join(root, 'output/fixture/dependencies-usage.csv'), 'utf8');
    assert.ok(complete.includes('"dependencyClass"'));
    assert.ok(complete.includes('"rust-import","structure"'));
    assert.ok(!usage.includes('"rust-import","structure"'));
    assert.ok(usage.includes('"rust-type","usage"'));
    assert.ok((await readFile(join(root, 'output/fixture/dependencies.dot'), 'utf8')).includes('rust-import'));
    assert.ok(!(await readFile(join(root, 'output/fixture/dependencies-usage.dot'), 'utf8')).includes('rust-import'));
    const source = await readFile(join(root, 'output/fixture/dependencies-source-usage.csv'), 'utf8');
    const communication = await readFile(join(root, 'output/fixture/dependencies-communication-usage.csv'), 'utf8');
    assert.ok(source.includes('rust-type'));
    assert.ok(!communication.includes('rust-type'));
    const server = await serve(join(root, 'output'), 0, { runtimeRoot: join(root, 'runtime') });
    try {
      const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
      const status = await (await fetch(base + '/api/status')).json();
      assert.equal(status.report.id, 'fixture');
      const overview = await (await fetch(base + '/api/reports/fixture/overview')).json();
      assert.equal(overview.modules.length, 2);
      const files = await (await fetch(base + '/api/reports/fixture/files?page=1')).json();
      assert.equal(files.total, 266);
      assert.ok(files.items.length <= 100);
      const detail = await (await fetch(base + '/api/reports/fixture/files?path=' + encodeURIComponent('src/目录/file-0.ts'))).json();
      assert.ok(detail.file.text.includes('export const value = 0'));
      const issues = await (await fetch(base + '/api/reports/fixture/issues?category=location&page=1')).json();
      assert.equal(issues.total, 205);
      assert.equal(issues.items.length, 100);
      const secondPage = await (await fetch(base + '/api/reports/fixture/issues?category=location&page=2')).json();
      assert.equal(secondPage.items.length, 100);
      const expired = await fetch(base + '/api/reports/old/overview');
      assert.equal(expired.status, 409);
      const unknown = await fetch(base + '/missing.csv');
      assert.equal(unknown.status, 404);
      await browserCheck(join(root, 'output'), join(runtimeRoot, 'logs/check/browser-fixture.png'));
    } finally {
      await new Promise((done) => server.close(done));
    }
  } finally {
    await rm(root, { recursive: true });
  }
});

test('empty report service returns a readable state page and rejects cross-origin scan starts', async () => {
  const root = await mkdtemp(join(runtimeRoot, 'work/empty-report '));
  const runtime = join(root, 'runtime');
  const server = await serve(join(root, 'output'), 0, { runtimeRoot: runtime });
  try {
    const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
    const home = await fetch(base + '/');
    assert.equal(home.status, 200);
    assert.ok((await home.text()).includes('尚无报告'));
    assert.deepEqual(await (await fetch(base + '/api/status')).json(), { report: null, scan: null, lastRun: null });
    const rejected = await fetch(base + '/api/scan', { method: 'POST', headers: { Origin: 'http://example.invalid' } });
    assert.equal(rejected.status, 403);
  } finally {
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true });
  }
});

test('scan API exposes progress, rejects overlap, preserves prior success and versions all detail and download reads', async () => {
  const root = await mkdtemp(join(runtimeRoot, 'work/scan-api '));
  const runtime = join(root, 'runtime'),
    output = join(root, 'output');
  await mkdir(runtime);
  let child = Object.assign(new ChildProcess(), { stdout: new PassThrough(), stderr: new PassThrough() });
  const server = await serve(output, 0, {
    runtimeRoot: runtime,
    launchScan: () => {
      child = Object.assign(new ChildProcess(), { stdout: new PassThrough(), stderr: new PassThrough() });
      return child;
    },
  });
  const base = `http://127.0.0.1:${/** @type {import('node:net').AddressInfo} */ (server.address()).port}`;
  const start = () => fetch(base + '/api/scan', { method: 'POST', headers: { Origin: base } });
  const status = async () => (await fetch(base + '/api/status')).json();
  try {
    assert.equal((await start()).status, 202);
    assert.equal((await start()).status, 409);
    child.stdout.emit('data', Buffer.from('Analyze Rust\n'));
    assert.equal((await status()).scan.phase, '分析 Rust');
    child.stderr.emit('data', Buffer.from('Source changed during scan: src/changed.ts'));
    child.emit('close', 1);
    assert.equal((await status()).scan.status, 'failed');
    const data = report();
    data.run.id = 'first';
    await mkdir(join(root, 'ready'));
    await renderReport(data, join(root, 'ready'));
    await publish(output, 'first', join(root, 'ready'));
    const before = await status();
    assert.equal(before.report.id, 'first');
    assert.equal(before.scan.status, 'failed');
    assert.equal((await start()).status, 202);
    assert.equal((await status()).report.id, 'first');
    data.run.id = 'second';
    await mkdir(join(root, 'next'));
    await renderReport(data, join(root, 'next'));
    await publish(output, 'second', join(root, 'next'));
    child.emit('close', 0);
    assert.equal((await status()).scan.status, 'success');
    assert.equal((await status()).report.id, 'second');
    for (const resource of [
      'overview',
      'modules/alpha',
      'files?path=src/consumer.rs',
      'issues?category=location',
      'downloads/facts.json',
    ]) {
      const response = await fetch(base + '/api/reports/first/' + resource);
      assert.equal(response.status, 409);
      assert.equal((await response.json()).error, 'report_updated');
    }
    assert.equal((await fetch(base + '/api/reports/second/files?path=../secret')).status, 404);
    assert.equal((await fetch(base + '/api/reports/second/downloads/facts.json')).status, 200);
    await cleanReports(false, { runtimeRoot: runtime, outputRoot: output });
    assert.equal((await status()).report, null);
    assert.equal((await fetch(base)).status, 200);
  } finally {
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true });
  }
});
