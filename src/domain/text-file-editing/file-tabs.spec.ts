import { expect, it } from 'vitest';
import { fileTabStatus, fileTabLabels } from './file-tabs';

it('distinguishes same-name file tabs', () => {
  const paths = ['M:/src/a/Entry.java', 'E:/b/Entry.java', 'jar:/dep!/Entry.java', 'M:/src/Other.java'];
  expect([...fileTabLabels(paths, 'M:/src').values()]).toEqual(['a/Entry.java', 'E:/b/Entry.java', 'jar:/dep!/Entry.java', 'Other.java']);
  expect([...fileTabLabels(paths.slice(0, 1), 'M:/src').values()]).toEqual(['Entry.java']);
});
it.each([
  [true, true, true, false, 'mod-tab-dirty', '有未保存修改'],
  [false, true, true, false, 'mod-tab-status error', '文件处理失败'],
  [false, false, true, false, 'mod-tab-status loading', '保存中'],
  [false, false, false, false, 'mod-tab-status', '已保存'],
  [false, false, false, true, 'mod-tab-status', '只读'],
] as const)('projects file state with workspace light priority', (dirty, error, saving, readOnly, className, label) => {
  expect(fileTabStatus(dirty, error, saving, readOnly)).toEqual({ className, label });
});
