import assert from 'node:assert/strict';
import { performanceScenarios } from '../scenarios.mjs';

/** @param {import('playwright').Page} page @param {string} artifacts */
export async function verifyTestbed(page, artifacts) {
  const checks = [];
  assert.deepEqual(
    await page.locator('#scene option').evaluateAll((options) => options.map((option) => option.getAttribute('value'))),
    performanceScenarios.map((scene) => scene.id),
  );
  assert.equal(await page.locator('a[href*="1461"]').count(), 0);
  for (const scene of performanceScenarios) {
    await page.locator('#scene').selectOption(scene.id);
    assert.equal(await page.locator('#file-bytes').isVisible(), scene.scale === 'files');
    assert.equal(await page.locator('#count').isDisabled(), scene.id === 'text-editor');
    await page.locator('#preview').click();
    await page.locator('#status').filter({ hasText: '样本已显示' }).waitFor();
    const sample =
      scene.scale === 'files' ? page.frameLocator('iframe[data-window]').locator(scene.selector) : page.locator(scene.selector);
    await sample.first().waitFor();
    if (scene.scale !== 'files') {
      const panel = page.locator('.table-panel,.variant-picker-list,.variant-hullmod-list');
      await panel.evaluate((element) => {
        element.scrollTop = 200;
        element.dispatchEvent(new Event('scroll'));
      });
      assert.ok(await panel.evaluate((element) => element.scrollTop > 0));
    }
    for (const width of [1280, 800])
      for (const theme of ['light', 'dark']) {
        await page.setViewportSize({ width, height: 720 });
        const toggle = page.getByRole('switch', { name: '主题明暗', exact: true });
        if ((await toggle.getAttribute('aria-checked')) !== String(theme === 'dark')) await toggle.click();
        await page.waitForFunction((theme) => Reflect.get(globalThis, 'testbed').host.settings.theme === theme, theme);
        await page.waitForFunction(
          (theme) =>
            Reflect.get(globalThis, 'document').querySelector('[role=switch][aria-label="主题明暗"]')?.getAttribute('aria-checked') ===
            String(theme === 'dark'),
          theme,
        );
        if (scene.scale === 'files')
          await page
            .frameLocator('iframe[data-window]')
            .locator('html[data-theme="' + theme + '"]')
            .waitFor();
        await page.screenshot({ path: artifacts + '/testbed-' + scene.id + '-' + width + '-' + theme + '.png', animations: 'disabled' });
      }
    await page.setViewportSize({ width: 1280, height: 720 });
    checks.push({ name: '测试台样本：' + scene.id, pass: true });
    await page.evaluate(() => Reflect.get(globalThis, 'testbed').close());
  }
  await page.locator('#scene').selectOption('weapons');
  await page.locator('#warmup').fill('1');
  await page.locator('#rounds').fill('2');
  await page.locator('.testbed-results > summary').click();
  await page.locator('#aa').click();
  await page.waitForFunction(
    () => Reflect.get(globalThis, 'document').querySelector('#status')?.getAttribute('data-complete') === 'true',
    undefined,
    { timeout: 120000 },
  );
  assert.equal(await page.locator('#status').textContent(), '对照通过');
  for (const format of ['json', 'md']) {
    const download = page.waitForEvent('download');
    await page.locator('#' + format).click();
    await (await download).saveAs(artifacts + '/export.' + format);
  }
  checks.push({ name: '测试台交替对照和报告导出', pass: true });
  return checks;
}
