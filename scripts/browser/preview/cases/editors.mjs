import assert from 'node:assert/strict';
import { join } from 'node:path';
import { verifyTextFeatures } from './text-features.mjs';

/** @param {import('playwright').Page} page */
export async function openEditorSample(page) {
  await page.getByText('打开子窗口', { exact: true }).click();
  await page.getByRole('button', { name: '代码编辑器', exact: true }).click();
  await page.getByText('打开子窗口', { exact: true }).click();
  const label = await page.evaluate(() => {
    const workspace = Reflect.get(globalThis, 'browserWorkspace');
    return [...workspace.windows].find(([, entry]) => entry.context?.kind === 'code-editor')[0];
  });
  const editor = page.frameLocator('iframe[data-window="' + label + '"]');
  await editor.getByRole('textbox', { name: '文件内容' }).waitFor();
  return editor;
}

/** @param {import('playwright').FrameLocator} editor */
export async function closeEditorDocuments(editor) {
  const buttons = editor.getByRole('button', { name: /^关闭 / });
  while (await buttons.count()) await buttons.first().click();
  assert.equal(await editor.getByRole('tab').count(), 0);
}

/** @param {import('playwright').Page} page @param {string} output */
export async function verifyEditors(page, output) {
  const editor = await openEditorSample(page);
  const controls = editor.locator('.code-editor-header button');
  assert.equal(await controls.count(), 7);
  for (const control of await controls.all()) {
    assert.equal((await control.innerText()).trim(), '');
    assert.equal(await control.locator('svg').count(), 1);
    assert.ok(await control.getAttribute('aria-label'));
    assert.ok(await control.getAttribute('title'));
  }
  await editor.getByRole('button', { name: '查找与替换', exact: true }).hover();
  const tooltip = editor.getByRole('tooltip').filter({ hasText: '查找与替换' });
  await tooltip.waitFor();
  const tooltipFont = await tooltip.evaluate((element) => {
    const view = /** @type {Window} */ (element.ownerDocument.defaultView);
    return {
      actual: view.getComputedStyle(element).fontFamily,
      field: view.getComputedStyle(element.ownerDocument.documentElement).getPropertyValue('--font-field').trim(),
    };
  });
  assert.equal(tooltipFont.actual.replace(/["']/g, ''), tooltipFont.field.replace(/["']/g, ''));
  /** @type {Record<string,unknown>} */
  const fontEvidence = { family: tooltipFont };
  const fontSession = await page.context().newCDPSession(page);
  /** @param {string|null} font */
  const setFieldFont = (font) =>
    page.evaluate(async (fieldFont) => {
      const workspace = Reflect.get(globalThis, 'browserWorkspace'),
        settings = await workspace.invoke('main', 'read_settings', {});
      await workspace.invoke('main', 'save_settings', { payload: { settings: { ...settings.value, fieldFont } } });
    }, font);
  const initialFieldFont = await page.evaluate(
    async () => (await Reflect.get(globalThis, 'browserWorkspace').invoke('main', 'read_settings', {})).value.fieldFont,
  );
  try {
    await fontSession.send('DOM.enable');
    await fontSession.send('CSS.enable');
    const nodes = (await fontSession.send('DOM.getFlattenedDocument', { depth: -1, pierce: true })).nodes;
    const node = nodes.find((node) => node.nodeName === 'SPAN' && node.attributes?.includes('tooltip'));
    assert.ok(node);
    fontEvidence.defaultGlyphs = (await fontSession.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId })).fonts;
    await setFieldFont('SimSun');
    assert.ok(
      (
        await tooltip.evaluate((element) => /** @type {Window} */ (element.ownerDocument.defaultView).getComputedStyle(element).fontFamily)
      ).startsWith('SimSun'),
    );
    const customFonts = (await fontSession.send('CSS.getPlatformFontsForNode', { nodeId: node.nodeId })).fonts;
    assert.ok(customFonts.some((font) => font.familyName === 'SimSun' && font.glyphCount === 5));
    fontEvidence.customGlyphs = customFonts;
  } finally {
    await setFieldFont(initialFieldFont);
    await fontSession.detach();
  }
  assert.equal(await editor.getByRole('tab').count(), 3);
  const surface = editor.getByRole('textbox', { name: '文件内容' });
  await surface.fill('modified third\n');
  assert.equal(await editor.getByRole('tab').last().getAttribute('aria-description'), '有未保存修改');
  await editor.getByRole('button', { name: '打开代码总览', exact: true }).click();
  const overview = editor.getByRole('region', { name: '代码总览', exact: true });
  await overview.waitFor();
  assert.equal(await editor.getByRole('tab', { selected: true }).count(), 0);
  assert.equal(await overview.locator('dl > div').filter({ hasText: '未保存文件' }).locator('dd').innerText(), '1');
  assert.equal(await overview.locator('dl > div').filter({ hasText: '已打开文件' }).locator('dd').innerText(), '3');
  assert.equal(await surface.isVisible(), false);
  await editor.getByRole('tab').last().click();
  assert.equal((await surface.locator('.cm-line').allTextContents()).join('\n'), 'modified third\n');
  await editor.getByRole('tab').first().click();
  await surface.fill('modified first\n');
  await page.evaluate(() => Reflect.get(globalThis, 'browserWorkspace').openSampleWindow('code-editor'));
  assert.equal(await editor.getByRole('tab').count(), 3);
  assert.equal((await surface.locator('.cm-line').allTextContents()).join('\n'), 'modified third\n');
  await editor.getByRole('button', { name: '保存全部', exact: true }).click();
  await editor.locator('footer').filter({ hasText: '已保存' }).waitFor();
  assert.equal(await editor.getByRole('tab').last().getAttribute('aria-description'), '已保存');
  const features = await verifyTextFeatures(editor);
  assert.equal(await page.evaluate(() => Reflect.get(globalThis, 'browserWorkspace').codeEditor.pending), 0);
  const checks = [
    { name: 'compact SVG toolbar, hover labels and field font', pass: true, fontEvidence },
    { name: 'open, overview statistics, retained drafts, status lights, reuse and save all', pass: true },
    features,
  ];
  const beforeComposition = (await surface.locator('.cm-line').allTextContents()).join('\n');
  await surface.focus();
  await surface.press('Control+End');
  const inputSession = await page.context().newCDPSession(page);
  try {
    await inputSession.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
    await inputSession.send('Input.insertText', { text: '中文' });
  } finally {
    await inputSession.detach();
  }
  assert.equal((await surface.locator('.cm-line').allTextContents()).join('\n'), beforeComposition + '中文');
  await surface.press('Control+z');
  assert.equal((await surface.locator('.cm-line').allTextContents()).join('\n'), beforeComposition);
  await surface.press('Control+y');
  assert.equal((await surface.locator('.cm-line').allTextContents()).join('\n'), beforeComposition + '中文');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.locator('footer').filter({ hasText: '已保存' }).waitFor();
  checks.push({ name: 'native IME commits one undo step and redo restores it', pass: true });
  const originalOrder = await editor.getByRole('tab').allTextContents();
  await editor.getByRole('tab').first().dragTo(editor.getByRole('tab').last());
  assert.notDeepEqual(await editor.getByRole('tab').allTextContents(), originalOrder);
  checks.push({ name: 'tab drag preserves native text view', pass: true });
  await page.setViewportSize({ width: 2242, height: 900 });
  for (const label of ['展开项目树', '展开大纲']) {
    const button = editor.getByRole('button', { name: label, exact: true });
    if (await button.count()) await button.click();
  }
  await editor.getByRole('button', { name: '诊断与引用', exact: true }).click();
  const treeHandle = editor.getByRole('separator', { name: '调整项目树宽度' });
  const originalTree = await treeHandle.getAttribute('aria-valuenow'),
    bounds = await treeHandle.boundingBox();
  assert.ok(bounds);
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 60);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 64, bounds.y + 60, { steps: 4 });
  await page.mouse.up();
  assert.notEqual(await treeHandle.getAttribute('aria-valuenow'), originalTree);
  const resizedTree = await treeHandle.getAttribute('aria-valuenow');
  await editor.getByRole('button', { name: '收起项目树', exact: true }).click();
  await editor.getByRole('button', { name: '展开项目树', exact: true }).click();
  assert.equal(await treeHandle.getAttribute('aria-valuenow'), resizedTree);
  for (const label of ['调整大纲宽度', '调整结果面板高度']) {
    const handle = editor.getByRole('separator', { name: label });
    const before = await handle.getAttribute('aria-valuenow');
    await handle.press(label.includes('大纲') ? 'ArrowLeft' : 'ArrowUp');
    assert.notEqual(await handle.getAttribute('aria-valuenow'), before);
  }
  await editor.getByText('当前项目没有诊断', { exact: true }).waitFor();
  await editor.getByRole('button', { name: '关闭结果面板', exact: true }).click();
  assert.equal(await editor.locator('.cm-editor').count(), 1);
  checks.push({ name: 'pointer resize, keyboard resize, collapse restoration and single text view', pass: true });
  for (const width of [1602, 2242, 2882])
    for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((theme) => Reflect.get(globalThis, 'browserWorkspace').setAppearance({ theme }), theme);
      await editor.getByRole('button', { name: '查找与替换', exact: true }).click();
      await editor.locator('.code-editor').screenshot({ path: join(output, 'code-editor-' + theme + '-' + width + '.png') });
      await editor.getByRole('textbox', { name: '查找', exact: true }).press('Escape');
      await editor.getByRole('button', { name: '打开代码总览', exact: true }).click();
      await overview.screenshot({ path: join(output, 'code-overview-' + theme + '-' + width + '.png') });
      await editor.getByRole('tab').filter({ hasText: 'Third.java' }).click();
      checks.push({ name: theme + '-' + width, pass: true });
    }
  await surface.fill(Array.from({ length: 100 }, (_, index) => String(index) + ' ' + 'x'.repeat(1000)).join('\n'));
  await surface.press('Control+Home');
  await surface.press('Shift+End');
  const selection = await surface.evaluate((element) => element.ownerDocument.getSelection()?.toString());
  const scrolling = editor.locator('.cm-scroller');
  const savedScroll = await scrolling.evaluate((element) => {
    element.scrollTop = 400;
    element.scrollLeft = 200;
    return { top: element.scrollTop, left: element.scrollLeft };
  });
  await editor.getByRole('button', { name: '打开代码总览', exact: true }).click();
  await editor.getByRole('tab').filter({ hasText: 'Third.java' }).click();
  await page.waitForTimeout(32);
  assert.deepEqual(await scrolling.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft })), savedScroll);
  assert.equal(await surface.evaluate((element) => element.ownerDocument.getSelection()?.toString()), selection);
  await editor.getByRole('tab').first().click();
  await editor.getByRole('tab').filter({ hasText: 'Third.java' }).click();
  assert.equal(await surface.evaluate((element) => element.ownerDocument.getSelection()?.toString()), selection);
  await page.waitForTimeout(32);
  assert.deepEqual(await scrolling.evaluate((element) => ({ top: element.scrollTop, left: element.scrollLeft })), savedScroll);
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.locator('footer').filter({ hasText: '已保存' }).waitFor();
  checks.push({ name: 'selection and horizontal/vertical scroll survive a document switch', pass: true });
  await page.evaluate(async () => {
    const workspace = Reflect.get(globalThis, 'browserWorkspace'),
      project = workspace.projects.find(
        /** @param {{manifest:{modRoot:string}}} entry */ (entry) => entry.manifest.modRoot.endsWith('/code_sample'),
      );
    const files = Array.from({ length: 50 }, (_, index) => ({ path: project.manifest.modRoot + `/notes/Item${index}.txt` }));
    for (const file of files) project.textFiles.set(file.path, 'Sample text');
    await workspace.invoke('main', 'open_code_editor', { input: { ...project.manifest, files }, key: crypto.randomUUID() });
  });
  await editor.getByRole('tab', { name: 'Item49.txt', exact: true }).waitFor();
  assert.equal(await editor.getByRole('tab', { name: 'Item49.txt', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await editor.getByRole('button', { name: '跳转声明', exact: true }).count(), 0);
  checks.push({ name: '50 sequential file tabs activate the final file and ordinary text exposes text operations', pass: true });
  await closeEditorDocuments(editor);
  await editor.getByRole('heading', { name: '选择文件开始编辑', exact: true }).waitFor();
  for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width: 1602, height: 900 });
    await page.evaluate((theme) => Reflect.get(globalThis, 'browserWorkspace').setAppearance({ theme }), theme);
    await editor.locator('.code-editor').screenshot({ path: join(output, 'code-empty-' + theme + '.png') });
  }
  checks.push({ name: 'all documents released', pass: true });
  checks.push(...(await verifyTextEditor(page, output)));
  return checks;
}

/** @param {import('playwright').Page} page @param {string} output */
async function verifyTextEditor(page, output) {
  const opened = await page.evaluate(async () => {
    const workspace = Reflect.get(globalThis, 'browserWorkspace'),
      project = workspace.projects.find((/** @type {{manifest:{modRoot:string}}} */ entry) =>
        entry.manifest.modRoot.endsWith('/code_sample'),
      );
    const path = project.manifest.modRoot + '/sample-text.java';
    project.textFiles.set(path, 'first\r\nsecond\nthird\rfinal');
    const result = await workspace.invoke('main', 'request_window', {
      payload: {
        identity: { type: 'text-editor', sessionId: project.manifest.sessionId, modRoot: project.manifest.modRoot, path },
        input: { kind: 'text-editor', location: { line: 2, column: 1, message: null, contextLabel: null, contextSeverity: null } },
        title: 'Sample text',
        width: 1000,
        height: 700,
        minWidth: 500,
        minHeight: 400,
      },
    });
    return { path, label: result.label };
  });
  const frame = page.frameLocator('iframe[data-window="' + opened.label + '"]');
  const input = frame.getByRole('textbox', { name: '文件内容' });
  await input.waitFor();
  await input.pressSequentially('中文 ');
  await frame.getByRole('button', { name: '保存', exact: true }).click();
  await frame.locator('.text-editor-status').filter({ hasText: '已保存' }).waitFor();
  const saved = () =>
    page.evaluate((path) => {
      const workspace = Reflect.get(globalThis, 'browserWorkspace');
      return workspace.projects
        .find((/** @type {{textFiles:Map<string,string>}} */ project) => project.textFiles.has(path))
        .textFiles.get(path);
    }, opened.path);
  assert.equal(await saved(), 'first\r\n中文 second\nthird\rfinal');
  await input.pressSequentially('world');
  await input.press('Control+z');
  assert.equal((await input.locator('.cm-line').allTextContents()).join('\n'), 'first\n中文 second\nthird\nfinal');
  await input.press('Control+z');
  assert.equal((await input.locator('.cm-line').allTextContents()).join('\n'), 'first\nsecond\nthird\nfinal');
  await input.press('Control+y');
  assert.equal(await frame.getByRole('button', { name: '保存', exact: true }).isDisabled(), true);
  await frame.locator('.text-editor-status').filter({ hasText: '已保存' }).waitFor();
  assert.equal(await saved(), 'first\r\n中文 second\nthird\rfinal');
  await frame.locator('.n-message').last().waitFor({ state: 'hidden' });
  await input.press('Control+End');
  const composition = await page.context().newCDPSession(page);
  try {
    await composition.send('Input.imeSetComposition', { text: '中', selectionStart: 1, selectionEnd: 1 });
    await composition.send('Input.insertText', { text: '中文' });
  } finally {
    await composition.detach();
  }
  assert.equal((await input.locator('.cm-line').allTextContents()).join('\n'), 'first\n中文 second\nthird\nfinal中文');
  await input.press('Control+z');
  assert.equal((await input.locator('.cm-line').allTextContents()).join('\n'), 'first\n中文 second\nthird\nfinal');
  const features = await verifyTextFeatures(frame);
  for (const theme of ['light', 'dark'])
    for (const width of [1280, 800]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((theme) => Reflect.get(globalThis, 'browserWorkspace').setAppearance({ theme }), theme);
      await frame.getByRole('button', { name: '查找与替换', exact: true }).click();
      await frame.locator('.text-editor-page').screenshot({ path: join(output, 'text-editor-' + theme + '-' + width + '.png') });
      await frame.getByRole('textbox', { name: '查找', exact: true }).press('Escape');
    }
  await frame.getByTitle('关闭', { exact: true }).click();
  await frame.owner().waitFor({ state: 'detached' });
  return [{ name: 'text editor mixed newlines, save boundary, native undo/redo and release', pass: true }, features];
}
