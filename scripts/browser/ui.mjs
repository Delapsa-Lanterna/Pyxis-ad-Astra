import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

/** @param {import('playwright').Browser} browser @param {string} url @param {string} output */
export async function verifyUI(browser, url, output) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  const checks = [];
  await mkdir(output, { recursive: true });
  try {
    await page.goto(url);
    await page.waitForFunction(() => 'testbed' in globalThis);
    for (const scene of ['settings', 'json', 'csv', 'ship', 'weapon', 'wing', 'variant', 'weapons', 'wings', 'hullmods']) {
      await page.locator('#scene').selectOption(scene);
      await page.locator('#preview').click();
      await page.locator('#status').filter({ hasText: '样本已显示' }).waitFor();
      await page.waitForFunction('document.querySelector("#app").textContent.length > 0');
      const selector =
        scene === 'csv'
          ? '.table-panel'
          : ['weapons', 'wings'].includes(scene)
            ? '.variant-picker-list'
            : scene === 'hullmods'
              ? '.variant-hullmod-list'
              : null;
      if (selector) {
        await page.locator(selector).waitFor();
        const box = await page.locator(selector).boundingBox();
        assert.ok(box, scene + ': scroll viewport is visible');
        const before = await page.locator(selector).evaluate((element) => element.scrollTop);
        await page.mouse.move(box.x + box.width / 2, box.y + Math.min(150, box.height / 2));
        await page.mouse.wheel(0, 500);
        await page.waitForFunction('document.querySelector(' + JSON.stringify(selector) + ').scrollTop > 0');
        const after = await page.locator(selector).evaluate((element) => element.scrollTop);
        assert.ok(after > before, scene + ': wheel must move the actual viewport');
        checks.push({ scene, input: 'mouse wheel', before, after });
        if (scene === 'csv') {
          await page.mouse.wheel(500, 0);
          await page.waitForFunction('document.querySelector(".table-panel").scrollLeft > 0');
          checks.push({ scene, input: 'horizontal wheel', after: await page.locator(selector).evaluate((element) => element.scrollLeft) });
        }
      }
      if (['weapons', 'wings'].includes(scene)) {
        const bounds = await page.locator('.variant-picker').boundingBox();
        const viewport = await page.locator('#app').boundingBox();
        assert.ok(bounds && viewport, scene + ': picker and scene are visible');
        assert.ok(
          bounds.y >= viewport.y && bounds.y + bounds.height <= viewport.y + viewport.height + 1,
          scene + ': picker must fit the scene',
        );
        checks.push({ scene, input: 'picker bounds', bounds, viewport });
      }
      await page.screenshot({ path: output + '/' + scene + '.png' });
    }
    await page.locator('summary').filter({ hasText: '执行结果与交替比较' }).click();
    await page.locator('#add-variant').click();
    assert.equal(await page.locator('.testbed-variant').count(), 3);
    await page.setViewportSize({ width: 800, height: 600 });
    await page.locator('#controls').hover();
    await page.mouse.wheel(0, 500);
    await page.waitForFunction('document.querySelector("#controls").scrollTop > 0');
    checks.push({ input: 'narrow controls wheel', after: await page.locator('#controls').evaluate((element) => element.scrollTop) });
    await page.screenshot({ path: output + '/narrow-panel.png' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.locator('#scene').selectOption('settings');
    await page.locator('#warmup').fill('2');
    await page.locator('#rounds').fill('3');
    await page.locator('#aa').click();
    await page.waitForFunction('document.querySelector("#status").dataset.complete === "true"', undefined, { timeout: 120000 });
    assert.equal(await page.locator('#status').textContent(), '对照通过');
    checks.push({ input: 'page comparison', pass: true });
    return checks;
  } finally {
    await context.close();
  }
}

/** @param {import('playwright').Browser} browser @param {string} url @param {string} output */
export async function verifyBrowserUI(browser, url, output) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage();
  const checks = [];
  await mkdir(output, { recursive: true });
  try {
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 720 });
      for (const theme of ['light', 'dark']) {
        for (const scene of ['settings', 'json', 'csv', 'ship', 'weapon', 'wing', 'variant', 'weapons', 'wings', 'hullmods']) {
          await page.goto(url + '/?scene=' + scene + '&theme=' + theme);
          await page.waitForFunction('document.querySelector("#status").dataset.ready === "true"');
          await page.screenshot({ path: output + '/' + scene + '-' + theme + '-' + width + '.png' });
          await page.locator('#close').click();
          await page.waitForFunction('document.querySelector("#app").childElementCount === 0');
          checks.push({ scene, theme, width, closed: true });
        }
      }
    }
    return checks;
  } finally {
    await context.close();
  }
}
