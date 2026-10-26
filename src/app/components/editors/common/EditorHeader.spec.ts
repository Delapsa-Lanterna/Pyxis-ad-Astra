import { mount, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import EditorHeader from './EditorHeader.vue';
import { editorUiStubs } from '@/test/unit/ui-stubs';
let wrapper: VueWrapper | null = null;
afterEach(() => wrapper?.unmount());
function mountHeader(props: {
  title: string;
  path?: string;
  dirty?: boolean;
  saving?: boolean;
  readonly?: boolean;
  externalUpdateNotice?: string;
}) {
  wrapper = mount(EditorHeader, { props, global: { stubs: editorUiStubs } });
  return wrapper;
}
describe('EditorHeader', () => {
  it('renders the entity title and its actual file path', () => {
    const header = mountHeader({ title: 'Sample', path: 'data/hulls/sample.ship' });
    expect(header.get('h1').text()).toBe('Sample');
    expect(header.get('.page-path').text()).toBe('data/hulls/sample.ship');
  });
  it.each([
    [false, false, '已保存'],
    [true, false, '有未保存修改'],
    [true, true, '保存中'],
  ] as const)('presents draft and saving state', (dirty, saving, text) => {
    expect(mountHeader({ title: 'Sample', dirty, saving }).get('[role="status"]').text()).toBe(text);
  });
  it('presents a read-only preview', () => {
    const header = mountHeader({ title: 'Sample', readonly: true });
    expect(header.text()).toContain('只读播放');
    expect(header.find('[role="status"]').exists()).toBe(false);
  });
  it('forwards the external version action', async () => {
    const header = mountHeader({ title: 'Sample', externalUpdateNotice: '外部版本已更新' });
    expect(header.text()).toContain('外部版本已更新');
    await header.get('button').trigger('click');
    expect(header.emitted('load-external')).toHaveLength(1);
  });
});
