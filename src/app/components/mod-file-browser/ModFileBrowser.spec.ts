import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { NTree } from 'naive-ui/es/tree';
import { NInput } from 'naive-ui/es/input';
import { NButton } from 'naive-ui/es/button';
import { defineComponent, h, reactive } from 'vue';
import { modFileTree } from '@/domain/mod-file-browser/file-tree';
import ModFileBrowser from './ModFileBrowser.vue';
const mocks = vi.hoisted(() => ({ vm: vi.fn() }));
const TestTree = defineComponent({
  inheritAttrs: false,
  setup(_props, { attrs, expose }) {
    expose({ scrollTo: vi.fn() });
    return () => h(NTree, { ...attrs, virtualScroll: false, animated: false });
  },
});
vi.mock('@/app/composables/mod-file-browser/use-mod-file-browser-view-model', () => ({ useModFileBrowserViewModel: mocks.vm }));
let wrapper: ReturnType<typeof mount> | null = null;
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function open() {
  const directories = new Map([
    [
      null,
      {
        entries: [
          { name: 'data', relPath: 'data', kind: 'directory' as const, sizeBytes: null, modifiedAt: 1700000000000 },
          { name: 'README', relPath: 'README', kind: 'file' as const, sizeBytes: 1024, modifiedAt: 1700000000000 },
          { name: 'linked', relPath: 'linked', kind: 'restricted' as const, sizeBytes: null, modifiedAt: null },
        ],
        loading: false,
        error: '',
      },
    ],
    ['data', { entries: [], loading: false, error: '拒绝读取目录' }],
  ]);
  const view = reactive({
    nodes: modFileTree(directories),
    searching: false,
    searchText: '',
    sort: { key: 'name' as const, ascending: true },
    expanded: [] as string[],
    selected: [] as string[],
    scrollTop: 0,
    title: 'M:/mod',
    loading: false,
    refreshing: false,
    ready: true,
    error: '',
    directories,
  });
  const actions = {
    activate: vi.fn(),
    refresh: vi.fn(),
    load: vi.fn(),
    setScroll: vi.fn(),
    setExpanded: vi.fn(),
    select: vi.fn((keys: string[]) => {
      view.selected = keys;
    }),
    navigate: vi.fn(),
    setSearch: vi.fn(),
    clearSearch: vi.fn(),
    collapseAll: vi.fn(),
    submitSearch: vi.fn(),
    setSort: vi.fn(),
  };
  mocks.vm.mockReturnValue({ view, actions });
  wrapper = mount(ModFileBrowser, {
    props: { target: { sessionId: 's1', modRoot: 'M:/mod' } },
    global: { components: { NTree: TestTree, NButton, NInput } },
    attachTo: document.body,
  });
  return { view, actions, wrapper };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(performance.now()));
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('matchMedia', (media: string) => ({ media, matches: false, addEventListener: () => {}, removeEventListener: () => {} }));
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(600);
});
describe('mod file browser controls', () => {
  it('keeps rapid switcher clicks separate from content double-clicks', async () => {
    const { view, actions, wrapper } = open();
    actions.setExpanded.mockImplementation((keys: string[]) => {
      view.expanded = keys;
    });
    actions.activate.mockImplementation((key: string) => {
      actions.setExpanded(view.expanded.includes(key) ? view.expanded.filter((path) => path !== key) : [...view.expanded, key]);
    });
    await flushPromises();
    const switcher = () => wrapper.get('[title="data"] [data-switcher] .n-tree-node-switcher__icon');
    await switcher().trigger('click');
    expect(view.expanded).toEqual(['data']);
    await switcher().trigger('click');
    expect(view.expanded).toEqual([]);
    await switcher().trigger('dblclick');
    expect(view.expanded).toEqual([]);
    expect(actions.activate).not.toHaveBeenCalled();
    const label = () => wrapper.get('[title="data"] .mod-files-name-text');
    await label().trigger('dblclick');
    expect(view.expanded).toEqual(['data']);
    await label().trigger('dblclick');
    expect(view.expanded).toEqual([]);
    expect(actions.activate).toHaveBeenCalledTimes(2);
  });
  it('records user scrolling while cached content is being refreshed', async () => {
    const { view, actions, wrapper } = open();
    await flushPromises();
    view.refreshing = true;
    const stage = wrapper.get('[aria-label="Mod 文件树"]');
    stage.element.scrollTop = 120;
    await stage.trigger('scroll');
    expect(actions.setScroll).toHaveBeenCalledWith(120);
  });
  it('preserves the captured browser position through transient tree scrolling during search changes', async () => {
    const { view, actions, wrapper } = open();
    await flushPromises();
    view.scrollTop = 120;
    view.searching = true;
    const stage = wrapper.get('[aria-label="Mod 文件树"]');
    stage.element.scrollTop = 0;
    await stage.trigger('scroll');
    expect(actions.setScroll).not.toHaveBeenCalled();
    await flushPromises();
    stage.element.scrollTop = 25;
    await stage.trigger('scroll');
    expect(actions.setScroll).toHaveBeenCalledWith(25);
  });
  it('keeps single selection separate from double-click activation and exposes node retry', async () => {
    const { actions, wrapper } = open();
    await flushPromises();
    const file = wrapper.find('[title="README"]');
    await file.trigger('click');
    expect(actions.select).toHaveBeenCalledWith(['README'], expect.anything(), expect.anything());
    expect(actions.activate).not.toHaveBeenCalled();
    await file.trigger('dblclick');
    expect(actions.activate).toHaveBeenCalledWith('README');
    await wrapper.get('[title="拒绝读取目录"]').trigger('click');
    expect(actions.load).toHaveBeenCalledWith('data');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '刷新')!
      .trigger('click');
    expect(actions.refresh).toHaveBeenCalledOnce();
    expect(wrapper.get('[title="linked"]').classes()).toContain('n-tree-node--disabled');
  });
  it('dispatches focused tree keys while the refresh button retains keyboard behavior', async () => {
    const { actions, wrapper } = open();
    await wrapper.get('[aria-label="Mod 文件树"]').trigger('keydown', { key: 'Enter' });
    expect(actions.navigate).toHaveBeenCalledWith('Enter');
    actions.navigate.mockClear();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '刷新')!
      .trigger('keydown', { key: 'Enter' });
    expect(actions.navigate).not.toHaveBeenCalled();
    await flushPromises();
  });
});

describe('file information toolbar', () => {
  it('shows the four sortable columns and passes search, clear and collapse actions', async () => {
    const { view, actions, wrapper } = open();
    await flushPromises();
    expect(wrapper.findAll('[role="columnheader"]').map((column) => column.text())).toEqual(['文件名', '类型', '大小', '修改时间']);
    expect(wrapper.findAll('[role="columnheader"]')[0]!.attributes('aria-sort')).toBe('ascending');
    await wrapper.findAll('[role="columnheader"]')[2]!.get('button').trigger('click');
    expect(actions.setSort).toHaveBeenCalledWith('size');
    await wrapper.get('input[aria-label="搜索整个 Mod 的文件名"]').setValue('file');
    expect(actions.setSearch.mock.lastCall?.[0]).toBe('file');
    await wrapper.get('input').trigger('keydown', { key: 'Enter' });
    expect(actions.submitSearch).toHaveBeenCalledOnce();
    expect(actions.submitSearch).toHaveBeenCalledWith();
    view.searchText = 'file';
    view.expanded = ['data'];
    await wrapper.vm.$nextTick();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '清空搜索')!
      .trigger('click');
    expect(actions.clearSearch).toHaveBeenCalledOnce();
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '全部收起')!
      .trigger('click');
    expect(actions.collapseAll).toHaveBeenCalledOnce();
    expect(wrapper.find('.mod-files-metadata').text()).toContain('文件夹');
    expect(wrapper.text()).toContain('1 KiB');
  });
});

it('delivers prop updates through the existing target getter', async () => {
  open();
  const getTarget = mocks.vm.mock.lastCall![0] as () => { sessionId: string; modRoot: string } | null;
  expect(getTarget()).toEqual({ sessionId: 's1', modRoot: 'M:/mod' });
  await wrapper!.setProps({ target: { sessionId: 's2', modRoot: 'M:/next' } });
  expect(getTarget()).toEqual({ sessionId: 's2', modRoot: 'M:/next' });
  await wrapper!.setProps({ target: null });
  expect(getTarget()).toBeNull();
});
