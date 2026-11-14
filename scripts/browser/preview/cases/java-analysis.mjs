import { appThemes } from '../../../shared/app-themes.mjs';
import assert from 'node:assert/strict';
import { join } from 'node:path';

/** @param {import('playwright').Page} page @param {string} artifacts */
export async function verifyJavaAnalysis(page, artifacts) {
  const checks = [];
  await page.goto(new URL('?page=settings', page.url()).href);
  const main = page.frameLocator('iframe[data-window="main"]');
  const card = main.locator('section').filter({ has: main.getByRole('heading', { name: 'Java 分析', exact: true }) });
  await card.getByRole('button', { name: '下载安装', exact: true }).waitFor();
  await card.getByText('目标版本 JDT 3.47.0 · 下载大小 15.66 MiB', { exact: false }).waitFor();
  const headings = await main.locator('section > h3').allTextContents();
  const index = headings.indexOf('Java 分析');
  assert.equal(headings[index - 1], '配置文件');
  assert.equal(headings[index + 1], '性能调试');
  checks.push({ cardOrder: headings.slice(index - 1, index + 2) });
  for (const width of [1280, 800])
    for (const theme of appThemes) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate((theme) => Reflect.get(globalThis, 'browserWorkspace').setAppearance({ theme }), theme);
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: join(artifacts, `${theme}-${width}.png`) });
      const bounds = await card.boundingBox();
      assert.ok(bounds && bounds.width > 0 && bounds.width <= width);
      checks.push({ theme, width, bounds });
    }
  await page.setViewportSize({ width: 1280, height: 1000 });
  const started = performance.now();
  await card.getByRole('button', { name: '下载安装', exact: true }).click();
  await card.getByText('正在下载', { exact: false }).waitFor();
  checks.push({ downloadInteractionMilliseconds: performance.now() - started });
  await card.screenshot({ path: join(artifacts, 'download.png') });
  const staleCancel = await page.evaluate(() => {
    const workspace = Reflect.get(globalThis, 'browserWorkspace');
    return workspace.invoke('main', 'cancel_java_analysis', { operationKey: 'expired-operation' });
  });
  assert.equal(staleCancel.active, true);
  checks.push({ staleCancelPreservedOperation: staleCancel.operationKey, active: staleCancel.active });
  await card.getByRole('button', { name: '取消操作', exact: true }).click();
  await card.getByText(/^已取消/).waitFor();
  await card.screenshot({ path: join(artifacts, 'cancelled.png') });
  await page.evaluate(() =>
    Reflect.get(globalThis, 'browserWorkspace').javaAnalysis.publish({
      phase: 'failed',
      error: '示例网络连接中断',
      installationPath: 'C:/示例配置/' + '组件目录/'.repeat(26) + 'java-analysis/dependencies/fixed',
    }),
  );
  await card.getByText('示例网络连接中断', { exact: false }).waitFor();
  await card.screenshot({ path: join(artifacts, 'failure-long-path.png') });
  await page.evaluate(() =>
    Reflect.get(globalThis, 'browserWorkspace').javaAnalysis.publish({
      installation: 'installed',
      installedBytes: 16777216,
      phase: 'succeeded',
      error: null,
      instances: 1,
      projects: 2,
    }),
  );
  await card.getByText('已安装版本 JDT 3.47.0', { exact: false }).waitFor();
  await card.getByText('16.00 MiB', { exact: true }).waitFor();
  assert.equal(await card.getByText('下载大小', { exact: false }).count(), 0);
  assert.equal(await card.getByRole('button', { name: '检查并修复', exact: true }).isDisabled(), true);
  assert.equal(await card.getByRole('button', { name: '移除组件', exact: true }).isDisabled(), true);
  const stop = card.getByRole('button', { name: '停止全部分析', exact: true });
  assert.equal(await stop.isDisabled(), false);
  assert.ok(await stop.evaluate((button) => button.classList.contains('n-button--error-type')));
  await card.screenshot({ path: join(artifacts, 'in-use.png') });
  await stop.click();
  const dialog = main.getByRole('dialog');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => Reflect.get(globalThis, 'browserWorkspace').javaAnalysis.publish({ instances: 0, projects: 0 }));
  await card.getByRole('button', { name: '环境自检', exact: true }).click();
  await card.getByText('最近检查：', { exact: false }).waitFor();
  await card.screenshot({ path: join(artifacts, 'self-check.png') });
  return checks;
}
