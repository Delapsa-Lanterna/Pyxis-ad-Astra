import assert from 'node:assert/strict';

/** @param {import('playwright').Page|import('playwright').FrameLocator} editor */
export async function verifyTextFeatures(editor) {
  const input = editor.getByRole('textbox', { name: '文件内容' });
  const source = 'class Sample {\n  void run() {\n    int value = 1; // value\n  }\n}';
  await input.fill(source);
  await editor.locator('.text-token-keyword').first().waitFor();
  assert.ok(await editor.locator('.cm-lineNumbers').count());
  await input.press('Control+Home');
  await input.press('ArrowDown');
  await input.press('End');
  await input.press('Enter');
  assert.equal((await input.locator('.cm-line').allTextContents())[2], '    ');
  await input.press('Control+z');
  await editor.getByTitle('折叠代码', { exact: true }).last().click();
  await editor.locator('.cm-foldPlaceholder').waitFor();
  assert.equal(await editor.locator('.cm-foldPlaceholder').innerText(), '');
  assert.equal(await editor.locator('.cm-foldPlaceholder svg').count(), 1);
  const tabs = editor.getByRole('tab');
  if ((await tabs.count()) > 1) {
    await tabs.first().click();
    assert.equal(await editor.locator('.cm-foldPlaceholder').count(), 0);
    await tabs.last().click();
    await editor.locator('.cm-foldPlaceholder').waitFor();
  }
  await editor.locator('.cm-foldPlaceholder').click();
  await input.press('Control+f');
  const find = editor.getByRole('textbox', { name: '查找', exact: true });
  await find.fill('value');
  assert.equal(await editor.getByRole('button', { name: '关闭查找', exact: true }).locator('svg').count(), 1);
  await find.press('Enter');
  if ((await tabs.count()) > 1) {
    await tabs.first().click();
    assert.equal(await editor.locator('.cm-search').count(), 0);
    await tabs.last().click();
    assert.equal(await find.inputValue(), 'value');
  }
  await editor.getByRole('textbox', { name: '替换', exact: true }).fill('count');
  await editor.getByRole('button', { name: '替换全部', exact: true }).click();
  await find.press('Escape');
  assert.equal(await editor.locator('.cm-search').count(), 0);
  assert.ok((await input.locator('.cm-line').allTextContents()).join('\n').includes('int count = 1; // count'));
  await input.press('Control+z');
  assert.equal((await input.locator('.cm-line').allTextContents()).join('\n'), source);
  await input.press('Control+y');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await editor.locator('footer,.text-editor-status').filter({ hasText: '已保存' }).waitFor();
  await input.press('Control+h');
  await find.fill('[');
  await editor.getByText('正则表达式', { exact: true }).click();
  await find.press('Enter');
  assert.ok(await editor.locator('.cm-search').count());
  await find.press('Escape');
  return { name: 'Java highlighting, indentation, folding, current-file replace, undo/redo and search dismissal', pass: true };
}
