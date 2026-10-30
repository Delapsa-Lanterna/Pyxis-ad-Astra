import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { performanceScenarios } from './scenarios.mjs';

/** @param {import('playwright').Page} page */
function diagnostics(page) {
  const errors = /** @type {string[]} */ ([]);
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) errors.push(message.type() + ': ' + message.text());
  });
  return errors;
}

/** @param {import('playwright').Page} page @param {string} output @param {string} name @param {'browserTest'|'testbed'} owner */
async function appearanceMatrix(page, output, name, owner) {
  const checks = [];
  for (const width of [1280, 800])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 720 });
      const toggle = page.getByRole('switch', { name: '主题明暗', exact: true });
      if ((await toggle.getAttribute('aria-checked')) !== String(theme === 'dark')) await toggle.click();
      await page.getByRole('button', { name: '主题色：绿', exact: true }).click();
      await page.waitForFunction(
        ({ owner, theme }) => {
          const settings = Reflect.get(globalThis, owner).host.settings;
          return settings.theme === theme && settings.accent === 'green';
        },
        { owner, theme },
      );
      const area = await page.locator('#app').boundingBox();
      assert.ok(area && area.height > 0 && area.x >= 0 && area.width <= width, name + ': visible test area');
      await page.screenshot({ path: output + '/' + name + '-' + theme + '-' + width + '.png' });
      checks.push({ name, theme, width, accent: 'green', pass: true });
    }
  await page.setViewportSize({ width: 1280, height: 720 });
  await customColorCheck(page, owner);
  return checks;
}

/** @param {import('playwright').Page} page @param {'browserTest'|'testbed'|'browserWorkspace'} owner */
async function customColorCheck(page, owner) {
  assert.equal(await page.locator('.browser-appearance input[type="color"]').count(), 0);
  assert.equal(await page.getByRole('button', { name: '自定义颜色', exact: true }).count(), 1);
  await page.getByLabel('自定义颜色值', { exact: true }).fill('#ab7733');
  await page.getByLabel('自定义颜色值', { exact: true }).press('Tab');
  await page.waitForFunction((owner) => {
    const root = Reflect.get(globalThis, owner);
    return (owner === 'browserWorkspace' ? root.appearance : root.host.settings).customAccent === '#ab7733';
  }, owner);
  await page.getByRole('button', { name: '自定义颜色', exact: true }).click();
  await page.getByPlaceholder('HEX', { exact: true }).fill('#7755aa');
  await page.getByPlaceholder('HEX', { exact: true }).press('Enter');
  await page.mouse.click(5, 700);
  await page.waitForFunction((owner) => {
    const root = Reflect.get(globalThis, owner);
    return (owner === 'browserWorkspace' ? root.appearance : root.host.settings).customAccent === '#7755aa';
  }, owner);
}

/** @param {import('playwright').Browser} browser @param {string} url @param {string} output */
export async function verifyUI(browser, url, output) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage(),
    checks = [],
    errors = diagnostics(page);
  await mkdir(output, { recursive: true });
  try {
    await page.goto(url);
    await page.waitForFunction(() => 'testbed' in globalThis);
    assert.equal(await page.locator('#app').evaluate((element) => element.childElementCount), 0, 'samples load on demand');
    assert.equal(await page.locator('a[href*="1461"]').count(), 0, 'performance surface is independent');
    assert.deepEqual(
      await page.locator('#scene option').evaluateAll((options) => options.map((item) => item.getAttribute('value'))),
      performanceScenarios.map(({ id }) => id),
    );
    for (const item of performanceScenarios) {
      await page.locator('#scene').selectOption(item.id);
      await page.locator('#preview').click();
      await page.locator('#status').filter({ hasText: '样本已显示' }).waitFor();
      await page.locator(item.selector).first().waitFor();
      const panel = page.locator('.table-panel,.variant-picker-list,.variant-hullmod-list');
      const bounds = await panel.boundingBox();
      assert.ok(bounds);
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + Math.min(100, bounds.height / 2));
      await page.mouse.wheel(0, 500);
      await page.waitForFunction(
        () =>
          (Reflect.get(globalThis, 'document').querySelector('.table-panel,.variant-picker-list,.variant-hullmod-list')?.scrollTop ?? 0) >
          0,
      );
      checks.push({ performance: item.id, wheel: true });
      checks.push(...(await appearanceMatrix(page, output, item.id, 'testbed')));
    }
    await page.locator('#scene').selectOption('weapons');
    await page.locator('#warmup').fill('1');
    await page.locator('#rounds').fill('2');
    await page.locator('.testbed-results > summary').click();
    await page.locator('#aa').click();
    await page.waitForFunction(
      () => Reflect.get(globalThis, 'document').querySelector('#status')?.getAttribute('data-complete') === 'true',
      undefined,
      {
        timeout: 120000,
      },
    );
    assert.equal(await page.locator('#status').textContent(), '对照通过');
    for (const format of ['json', 'md']) {
      const download = page.waitForEvent('download');
      await page.locator('#' + format).click();
      await (await download).saveAs(output + '/export.' + format);
    }
    checks.push({ comparison: true, export: ['json', 'md'] });
    assert.deepEqual(errors, []);
    return checks;
  } finally {
    await context.close();
  }
}

/** @param {import('playwright').Page} page */
async function fieldsCheck(page) {
  assert.equal(await page.locator('[data-gallery="fields"] [data-case]').count(), 20);
  const weapons = page.locator('[data-case="weapons"]');
  await weapons.getByRole('button', { name: '+ 添加项' }).click();
  const menu = page.locator('.n-base-select-menu');
  const options = await menu.locator('.n-base-select-option').allInnerTexts();
  assert.ok(options.length > 2);
  const selected = (options.at(-1) ?? '').trim(),
    selectedId = selected.split(' · ')[0];
  await page.keyboard.press('Escape');
  assert.ok(!(await page.locator('[data-gallery-value]').innerText()).includes(JSON.stringify(selectedId)));
  await weapons.getByRole('button', { name: '+ 添加项' }).click();
  await menu.getByText(selected, { exact: true }).click();
  assert.equal(await weapons.locator('.field-map-key-editor').innerText(), selectedId);
  for (const key of ['modulesObject', 'modulesArray']) {
    const sample = page.locator('[data-case="' + key + '"]');
    await sample.getByRole('button', { name: '+ 添加项' }).click();
    const options = await page.locator('.n-base-select-menu .n-base-select-option').allInnerTexts();
    assert.ok(options.length > 0);
    assert.ok(options[0]);
    const option = options[0].trim();
    await page.locator('.n-base-select-menu').getByText(option, { exact: true }).click();
    assert.equal(await sample.locator('.field-map-key-editor').innerText(), option.split(' · ')[0]);
  }
  const input = page.locator('[data-case="string"] input');
  await input.fill('Pending sample');
  await page.getByRole('button', { name: '取消输入', exact: true }).click();
  assert.equal(await input.inputValue(), 'Sample');
  await input.fill('Committed sample');
  await page.getByRole('button', { name: '提交输入', exact: true }).click();
  assert.ok((await page.locator('[data-gallery-value]').innerText()).includes('Committed sample'));
  for (const state of ['required', 'readonly', 'empty', 'long', 'normal']) {
    await page.getByLabel('字段状态').selectOption(state);
    if (state === 'readonly') assert.equal(await input.isDisabled(), true);
    if (state === 'empty') assert.ok(!(await page.locator('[data-gallery-value]').innerText()).includes('"integer"'));
    if (state === 'long') assert.ok((await page.locator('[data-case="text"] textarea').inputValue()).length > 100);
  }
  await page.getByLabel('字段编辑方式').selectOption('plain');
  await page.locator('[data-case="weapons"]').locator('textarea,input').first().waitFor();
  const number = page.locator('[data-case="integer"] input');
  await number.fill('1e');
  await page.getByRole('button', { name: '提交输入', exact: true }).click();
  await page.locator('.n-message').filter({ hasText: '字段校验' }).waitFor();
  assert.equal(await number.inputValue(), '1e');
  await number.press('Escape');
  await page.getByLabel('字段编辑方式').selectOption('smart');
}

/** @param {import('playwright').Page} page */
async function pickerCheck(page) {
  const search = page.locator('.variant-picker input,.variant-hullmod-dialog input').first();
  await search.fill('no_matching_sample');
  await page.waitForFunction(() =>
    [...Reflect.get(globalThis, 'document').querySelectorAll('[data-entry-id]')].every((node) => node.getClientRects().length === 0),
  );
  await search.fill('');
  const row = page.locator('[data-entry-id]:visible').first();
  await row.waitFor();
  await row.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => Boolean(Reflect.get(globalThis, 'document').querySelector('#app')?.getAttribute('data-selected-id')));
  const selected = await page.locator('#app').getAttribute('data-selected-id');
  assert.ok(selected);
  await row.click();
  assert.equal(await page.locator('#app').getAttribute('data-selected-id'), await row.getAttribute('data-entry-id'));
}

/** @param {import('playwright').Page} page */
async function resourceCheck(page) {
  await page.locator('[data-gallery="resources"] img').first().waitFor();
  for (const state of ['loading', 'empty', 'failed']) {
    await page.getByLabel('资源状态').selectOption(state);
    if (state === 'loading') await page.locator('.n-spin').waitFor();
    if (state === 'empty') assert.equal(await page.locator('[data-gallery="resources"] img').count(), 0);
    if (state === 'failed') await page.locator('.n-message').filter({ hasText: '测试资源读取失败' }).waitFor();
  }
  await page.getByRole('button', { name: '重新加载资源' }).click();
  await page.locator('[data-gallery="resources"] img').first().waitFor();
  await page.getByLabel('原版字体').uncheck();
  await page.locator('.font-default').waitFor();
  await page.getByLabel('原版字体').check();
}

/** @param {import('playwright').Page} page */
async function feedbackCheck(page) {
  await page.getByRole('button', { name: '确认操作', exact: true }).click();
  await page.locator('.n-dialog').getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.locator('[data-feedback-result]').innerText(), '操作已取消');
  await page.getByRole('button', { name: '多项选择', exact: true }).click();
  await page.getByRole('button', { name: '选择 B', exact: true }).click();
  assert.equal(await page.locator('[data-feedback-result]').innerText(), 'B');
  await page.locator('[data-menu-target]').click({ button: 'right' });
  await page.getByText('禁用动作', { exact: true }).waitFor();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() =>
    Reflect.get(globalThis, 'document').querySelector('[data-feedback-result]')?.textContent?.includes('菜单动作已执行'),
  );
  await page.getByRole('button', { name: '打开浮层' }).click();
  await page.locator('.n-popover').waitFor();
  await page.keyboard.press('Escape');
}

/** @param {import('playwright').Browser} browser @param {string} url @param {string} output */
export async function verifyBrowserUI(browser, url, output) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  const page = await context.newPage(),
    errors = diagnostics(page);
  const checks = /** @type {Record<string, unknown>[]} */ ([]);
  await mkdir(output, { recursive: true });
  try {
    await page.goto(url);
    const main = page.frameLocator('iframe[data-window="main"]');
    await main.getByRole('button', { name: '进入编辑' }).first().click();
    await main.getByRole('button', { name: '打开原版' }).click();
    await main.getByText('远行星号原版', { exact: true }).last().waitFor();
    await main.getByText('正在加载 Mod', { exact: true }).waitFor({ state: 'detached' });
    checks.push({ coreOpen: true });
    await main.locator('.mod-tab').first().click();
    await customColorCheck(page, 'browserWorkspace');
    assert.equal(await page.locator('a[href*="1462"]').count(), 0);
    await page.locator('.workbench-catalog > summary').click();
    assert.equal(await page.locator('[data-scene-id]').count(), 7);
    assert.equal(await page.locator('[data-navigation-id]').count(), 30);
    await page.locator('.workbench-catalog > summary').click();
    for (const button of await main.locator('.mod-navigation-button').all()) {
      await button.click();
      assert.match((await button.getAttribute('class')) ?? '', /\bactive\b/);
    }
    checks.push({ formalNavigation: 23 });
    /** @type {{variantId:string,index:number,slot:{id:string,type:string,size:string,mount:string},weaponId:string,weaponName:string,originalEntries:number}} */
    const variantPlan = await page.evaluate(() => {
      const workspace =
        /** @type {{projects:Array<{entities:Map<string,{kind:string,id:string,data:Record<string,unknown>}>,tables:Map<string,{rows:Array<{data:Record<string,unknown>}>}>}>}} */ (
          Reflect.get(globalThis, 'browserWorkspace')
        );
      const project = workspace.projects[1];
      if (!project) throw Error('Expected the registered Mod fixture project');
      for (const entity of project.entities.values()) {
        if (entity.kind !== 'variant') continue;
        const value = /** @type {{hullId:string,weaponGroups:Array<{weapons:Record<string,string>}>}} */ (entity.data),
          hull = project.entities.get('ship:' + value.hullId),
          groups = value.weaponGroups ?? [];
        if (!hull || groups.length < 2) continue;
        const occupied = new Set(
          groups.flatMap((group /** @type {{weapons:Record<string,string>}} */) => Object.keys(group.weapons ?? {})),
        );
        for (let index = 0; index < groups.length; index++) {
          const slots = /** @type {Array<{id:string,type:string,size:string,mount:string}>} */ (hull.data.weaponSlots);
          const slot = slots.find(
            (slot /** @type {{id:string,type:string,size:string,mount:string}} */) =>
              !occupied.has(slot.id) && slot.mount !== 'HIDDEN' && !['SYSTEM', 'DECORATIVE', 'STATION_MODULE'].includes(slot.type),
          );
          if (!slot) continue;
          const weapon = project.tables.get('weapons')?.rows.find((row /** @type {{data:Record<string,unknown>}} */) => {
            const weaponEntity = project.entities.get('weapon:' + String(row.data.id));
            const spec = /** @type {{size:string,type:string}|undefined} */ (weaponEntity?.data.spec);
            return (
              spec &&
              spec.size === slot.size &&
              ((slot.type === 'MISSILE' && spec.type === 'MISSILE') ||
                (slot.type === 'ENERGY' && spec.type === 'ENERGY') ||
                (['BALLISTIC', 'HYBRID', 'COMPOSITE', 'SYNERGY', 'UNIVERSAL'].includes(slot.type) && spec.type === 'BALLISTIC'))
            );
          });
          if (weapon)
            return {
              variantId: entity.id,
              index,
              slot: { id: slot.id, type: slot.type, size: slot.size, mount: slot.mount },
              weaponId: String(weapon.data.id),
              weaponName: String(weapon.data.name),
              originalEntries: Object.keys(groups[index]?.weapons ?? {}).length,
            };
        }
      }
      throw Error('No source variant has a free compatible hull slot');
    });
    await page.goto(url + '/?navigation=json%3Avariants');
    await main.locator(`.json-entity-list-item[data-entity-id="${variantPlan.variantId}"]`).click();
    /** @param {string} name */
    const group = (name) =>
      main
        .locator('.n-collapse-item')
        .filter({ has: main.getByText(name, { exact: true }) })
        .last();
    const groupName = '武器组 ' + (variantPlan.index + 1);
    if (!(await group(groupName).evaluate((node) => node.classList.contains('n-collapse-item--active'))))
      await group(groupName).locator('.n-collapse-item__header-main').click();
    await group(groupName).getByRole('button', { name: '+ 添加项', exact: true }).first().click();
    /** @type {Record<string,string>} */ const sizeLabels = { SMALL: '小型', MEDIUM: '中型', LARGE: '大型' };
    /** @type {Record<string,string>} */ const typeLabels = {
      BALLISTIC: '实弹',
      ENERGY: '能量',
      MISSILE: '导弹',
      HYBRID: '混合',
      COMPOSITE: '复合',
      SYNERGY: '协同',
      UNIVERSAL: '通用',
    };
    /** @type {Record<string,string>} */ const mountLabels = { HARDPOINT: '固定', TURRET: '炮塔', HIDDEN: '隐藏' };
    const slotLabel = [
      variantPlan.slot.id,
      typeLabels[variantPlan.slot.type] ?? variantPlan.slot.type,
      sizeLabels[variantPlan.slot.size] ?? variantPlan.slot.size,
      mountLabels[variantPlan.slot.mount] ?? variantPlan.slot.mount,
    ].join(' · ');
    await main.locator('.n-base-select-menu').getByText(slotLabel, { exact: true }).click();
    const slotKeys = group(groupName).locator('.field-map-key-editor');
    assert.equal(await slotKeys.count(), variantPlan.originalEntries + 1);
    assert.ok((await slotKeys.allInnerTexts()).includes(variantPlan.slot.id));
    await main.getByRole('button', { name: '撤销', exact: true }).click();
    assert.equal(await group(groupName).locator('.field-map-key-editor').count(), variantPlan.originalEntries);
    await main.getByRole('button', { name: '重做', exact: true }).click();
    await group(groupName).locator('.n-base-selection').last().click();
    await main.locator('.n-base-select-menu').getByText(variantPlan.weaponName, { exact: true }).click();
    await main.getByRole('button', { name: '保存', exact: true }).click();
    await page.waitForFunction(
      ({ variantId, index, slotId, weaponId }) =>
        Reflect.get(globalThis, 'browserWorkspace').projects[1].entities.get('variant:' + variantId).data.weaponGroups[index].weapons[
          slotId
        ] === weaponId,
      { variantId: variantPlan.variantId, index: variantPlan.index, slotId: variantPlan.slot.id, weaponId: variantPlan.weaponId },
    );
    checks.push({ formalVariant: 'source slot, compatible weapon, undo, redo, save', pass: true, slot: variantPlan.slot.id });
    const routes = /** @type {{id:string,href:string,label:string}[]} */ (
      await page.evaluate(() => Reflect.get(globalThis, 'browserWorkspaceEntries'))
    );
    for (const route of routes) {
      await page.goto(url + route.href);
      if (route.id.startsWith('navigation-'))
        await main.locator('.mod-navigation-button.active .mod-navigation-button-label').filter({ hasText: route.label }).waitFor();
      else if (route.id.startsWith('global-'))
        await main.getByRole('heading', { name: route.id === 'global-settings' ? '设置' : '关于', exact: true }).waitFor();
      else if (route.id.endsWith('-window')) await page.frameLocator('iframe[data-window^="window-"]').locator('.titlebar').waitFor();
      else await main.getByRole('button', { name: '进入编辑' }).first().waitFor();
      checks.push({ route: route.id, pass: true });
    }
    await page.goto(url);
    await main.getByRole('button', { name: '进入编辑' }).first().waitFor();
    await page.locator('.workbench-menu').first().locator('summary').click();
    for (const { selector, kinds, buttonName } of [
      { selector: '规格窗口类型', kinds: ['ship', 'weapon', 'projectile', 'system'], buttonName: '规格编辑器' },
      { selector: '沉浸式窗口类型', kinds: ['ship', 'skin', 'weapon', 'wing', 'variant'], buttonName: '沉浸式编辑器' },
    ])
      for (const kind of kinds) {
        await page.getByLabel(selector).selectOption(kind);
        await page.getByRole('button', { name: buttonName, exact: true }).click();
        const frame = page.locator('iframe[data-window^="window-"]').last(),
          child = frame.contentFrame();
        await child.locator('.titlebar-button.close').waitFor();
        await page.waitForFunction(
          (label) => Reflect.get(globalThis, 'browserWorkspace').windows.get(label)?.ready === true,
          await frame.getAttribute('data-window'),
        );
        await page.screenshot({ path: output + '/' + buttonName + '-' + kind + '.png' });
        await child.locator('.titlebar-button.close').click();
        await frame.waitFor({ state: 'detached' });
        checks.push({ window: buttonName, kind, closed: true });
      }
    const scenes = /** @type {{id:string,href:string,samples:string[],selector:string}[]} */ (
      await page.evaluate(() => Reflect.get(globalThis, 'browserScenarios'))
    );
    for (const scene of scenes.filter((item) => item.id !== 'workspace')) {
      await page.goto(url + scene.href);
      await page.locator('#status[data-ready="true"]').waitFor();
      for (const sample of scene.samples) {
        if (scene.samples.length > 1) {
          await page.getByLabel('场景样本').selectOption(sample);
          await page.locator('#status[data-ready="true"]').waitFor();
        }
        await page.locator(scene.selector).first().waitFor();
        if (scene.id === 'fields') await fieldsCheck(page);
        if (scene.id === 'resources') await resourceCheck(page);
        if (scene.id === 'feedback') await feedbackCheck(page);
        if (scene.id === 'pickers') await pickerCheck(page);
        checks.push(...(await appearanceMatrix(page, output, scene.id + '-' + sample, 'browserTest')));
      }
    }
    assert.deepEqual(errors, [], 'browser console and exceptions');
    return checks;
  } finally {
    await context.close();
  }
}
