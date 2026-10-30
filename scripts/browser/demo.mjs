import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const url = process.argv[2] ?? 'http://127.0.0.1:1463/Circinus-ad-Astra/';
const output = 'node_modules/.cache/browser/demo';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = /** @type {string[]} */ ([]);
const checks = /** @type {string[]} */ ([]);
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (['warning', 'error'].includes(message.type())) errors.push(message.type() + ': ' + message.text());
});
page.on('response', (response) => {
  if (response.status() >= 400) errors.push(response.status() + ': ' + response.url());
});
page.on('requestfailed', (request) => {
  if (request.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(request.url());
});
const started = performance.now();
let readyMs = 0,
  downloadBytes = 0;
try {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (
      await fetch(url).then(
        (response) => response.ok,
        () => false,
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await page.goto(url);
  const main = page.frameLocator('iframe[data-window="main"]');
  await main.getByRole('button', { name: '进入编辑' }).first().waitFor();
  readyMs = Math.round(performance.now() - started);
  downloadBytes = (
    await Promise.all(
      page
        .frames()
        .map((frame) =>
          frame.evaluate(() =>
            performance.getEntriesByType('resource').reduce((sum, entry) => sum + Reflect.get(entry, 'transferSize'), 0),
          ),
        ),
    )
  ).reduce((sum, size) => sum + size, 0);
  assert.equal(await page.locator('.workbench-menu').count(), 0);
  checks.push('工作区与精简工具栏');
  await main.getByRole('button', { name: '进入编辑' }).first().click();
  for (let index = 0; index < 23; index++) {
    const button = main.locator('.mod-navigation-button').nth(index);
    await button.click();
    assert.match((await button.getAttribute('class')) ?? '', /\bactive\b/);
    checks.push('导航 ' + (index + 1));
  }
  await main.locator('.mod-navigation-button').filter({ hasText: '舰船' }).first().click();
  await main
    .locator('.csv-grid-record')
    .first()
    .getByRole('gridcell')
    .first()
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await main.locator('.detail-thumbnail img').waitFor();
  checks.push('样本图片');
  for (const name of ['舰船编辑器', '沉浸式编辑器', '文件编辑器']) {
    await main.locator('.detail-actions').getByRole('button', { name, exact: true }).click();
    const frame = page.locator('iframe[data-window^="window-"]').last();
    await frame.contentFrame().locator('.titlebar-button.close').click();
    await frame.waitFor({ state: 'detached' });
    checks.push(name);
  }
  await main.locator('.mod-navigation-button').filter({ hasText: '武器' }).first().click();
  await main
    .locator('.csv-grid-record')
    .first()
    .getByRole('gridcell')
    .first()
    .click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await main.locator('.detail-actions').getByRole('button', { name: '开火预览', exact: true }).click();
  const preview = page.locator('iframe[data-window^="window-"]').last();
  await preview.contentFrame().locator('.titlebar-button.close').click();
  await preview.waitFor({ state: 'detached' });
  checks.push('武器开火预览');
  await main.locator('.mod-navigation-button').filter({ hasText: 'Mod 信息' }).click();
  const name = main.locator('[data-field-path="file.name"] input');
  const original = await name.inputValue();
  await name.fill(original + ' Demo');
  await name.press('Tab');
  await main.getByRole('button', { name: '保存', exact: true }).click();
  await page.waitForFunction(() => Reflect.get(globalThis, 'browserWorkspace').projects[1].manifest.modInfo.name.endsWith(' Demo'));
  checks.push('编辑与保存');
  await main.locator('.mod-navigation-button').filter({ hasText: '舰船' }).first().click();
  for (const width of [1280, 800]) {
    await page.setViewportSize({ width, height: 720 });
    for (const dark of [false, true]) {
      const toggle = page.getByRole('switch', { name: '主题明暗' });
      if ((await toggle.getAttribute('aria-checked')) !== String(dark)) await toggle.click();
      await page.getByRole('button', { name: '主题色：绿' }).click();
      await page.waitForFunction((dark) => {
        const appearance = Reflect.get(globalThis, 'browserWorkspace').appearance;
        return appearance.theme === (dark ? 'dark' : 'light') && appearance.accent === 'green';
      }, dark);
      await main.locator(`html[data-theme="${dark ? 'dark' : 'light'}"]`).waitFor();
      const outerColor = await page
        .locator('.browser-workspace-shell')
        .evaluate((node) => Reflect.get(globalThis, 'getComputedStyle')(node).getPropertyValue('--color-primary'));
      assert.equal(
        await main
          .locator('html')
          .evaluate((node) => Reflect.get(globalThis, 'getComputedStyle')(node).getPropertyValue('--color-primary')),
        outerColor,
      );
      await page.screenshot({ path: `${output}/${width}-${dark ? 'dark' : 'light'}.png` });
      checks.push(`${width} ${dark ? '深色' : '浅色'}`);
    }
  }
  await page.getByRole('button', { name: '恢复样本', exact: true }).click();
  await main.getByRole('button', { name: '进入编辑' }).first().waitFor();
  assert.equal(await page.evaluate(() => Reflect.get(globalThis, 'browserWorkspace').projects[1].manifest.modInfo.name), original);
  await page.reload();
  await main.getByRole('button', { name: '进入编辑' }).first().waitFor();
  checks.push('恢复样本与刷新');
  assert.deepEqual(errors, []);
} catch (error) {
  errors.push(String(error));
  await page.screenshot({ path: output + '/failure.png' });
} finally {
  const report = { url, pass: errors.length === 0, readyMs, downloadBytes, checks, errors };
  await writeFile(output + '/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  await browser.close();
  if (errors.length) process.exitCode = 1;
}
