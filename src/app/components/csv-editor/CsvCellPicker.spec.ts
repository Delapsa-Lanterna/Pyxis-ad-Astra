import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectOption } from '@/domain/schema/schema-options';
import CsvCellPicker from './CsvCellPicker.vue';
import { NCollapse, NCollapseItem } from 'naive-ui/es/collapse';
import { installNaiveUi } from '@/app/naive-ui.runtime';
import type { CsvCellEdit } from '@/app/composables/csv-editor/csv-cell-edit';
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));

vi.mock('@/services/resource-media.service', () => ({
  resourceMediaDataUrl: vi.fn().mockReturnValue(undefined),
  subscribeResourceInvalidations: vi.fn(() => () => {}),
}));

function mountPicker(
  anchor: { height: number; left: number; top: number; width: number },
  props: {
    multiple?: boolean;
    options?: SelectOption[];
    values?: string[];
    edit?: CsvCellEdit;
    rawValue?: string;
    onUpdateRaw?: (value: string) => void;
  } = {},
) {
  return mount(CsvCellPicker, {
    attachTo: document.body,
    props: { anchor, sessionId: 'sess-1', multiple: false, options: [], values: [], ...props },
    global: { plugins: [createPinia()], components: { NCollapse, NCollapseItem } },
  });
}

describe('CsvCellPicker placement', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.stubGlobal('innerHeight', 800);
  });

  afterEach(() => {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each([
    ['ArrowDown', ['beta'], 'gamma'],
    ['ArrowUp', ['beta'], 'alpha'],
    ['ArrowDown', [], 'alpha'],
    ['ArrowUp', [], 'gamma'],
  ] as const)('browses %s from %s and confirms %s once', async (key, values, expected) => {
    const wrapper = mountPicker(
      { height: 24, left: 0, top: 0, width: 200 },
      {
        values: [...values],
        options: ['alpha', 'beta', 'gamma'].map((value) => ({ label: value, value })),
      },
    );
    await flushPromises();
    const input = wrapper.get<HTMLInputElement>('input');
    await input.trigger('keydown', { key });
    expect(wrapper.get('.csv-cell-picker-option.active').text()).toBe(expected);
    expect(input.element.value).toBe('');
    expect(document.activeElement).toBe(input.element);
    expect(wrapper.emitted('commit')).toBeUndefined();
    expect(wrapper.emitted('update')).toBeUndefined();
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('commit')).toEqual([[[expected]]]);
    for (let i = 0; i < 3; i++) await input.trigger('keydown', { key });
    expect(wrapper.get('.csv-cell-picker-option.active').text()).toBe(key === 'ArrowDown' ? 'gamma' : 'alpha');
    wrapper.unmount();
  });
  it('skips collapsed groups, resets on typing and accepts refreshed candidates', async () => {
    const wrapper = mountPicker(
      { height: 24, left: 0, top: 0, width: 200 },
      {
        options: ['alpha', 'beta'].map((value) => ({ type: 'group', label: value, value, children: [{ label: value, value }] })),
      },
    );
    const input = wrapper.get('input');
    await wrapper.findAll('.n-collapse-item__header-main')[0]!.trigger('click');
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.get('.csv-cell-picker-option.active').text()).toBe('beta');
    await input.setValue('missing');
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.find('.csv-cell-picker-option.active').exists()).toBe(false);
    await wrapper.setProps({ options: [{ label: 'missing', value: 'new-id' }] });
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.get('.csv-cell-picker-option.active .csv-cell-picker-label').text()).toBe('missing');
    await wrapper.setProps({ options: [] });
    expect(wrapper.find('.csv-cell-picker-option.active').exists()).toBe(false);
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('commit')).toEqual([[['missing']]]);
    wrapper.unmount();
  });
  it('keeps keyboard candidate navigation with the input method during composition', async () => {
    const wrapper = mountPicker({ height: 24, left: 0, top: 0, width: 200 }, { options: [{ label: 'Alpha', value: 'alpha' }] });
    const input = wrapper.get('input');
    await input.trigger('keydown', { key: 'ArrowDown' });
    expect(wrapper.find('.csv-cell-picker-option.active').exists()).toBe(true);
    await input.trigger('compositionstart');
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter']) await input.trigger('keydown', { key, isComposing: true });
    expect(wrapper.find('.csv-cell-picker-option.active').exists()).toBe(false);
    expect(wrapper.emitted('commit')).toBeUndefined();
    wrapper.unmount();
  });

  it('opens downward when the panel fully fits below the anchor', () => {
    const wrapper = mountPicker({ height: 30, left: 40, top: 100, width: 200 });

    const style = wrapper.attributes('style');
    expect(style).toContain('top: 132px');
    expect(style).not.toContain('bottom');
    wrapper.unmount();
  });

  it('flips upward when the downward panel would be clipped by the window edge', () => {
    const wrapper = mountPicker({ height: 30, left: 40, top: 700, width: 200 });

    const style = wrapper.attributes('style');
    expect(style).toContain('bottom: 102px');
    expect(style).not.toContain('top:');
    wrapper.unmount();
  });

  it('keeps the downward side when the window is too short for either side', () => {
    vi.stubGlobal('innerHeight', 60);
    const wrapper = mountPicker({ height: 30, left: 40, top: 10, width: 200 });

    const style = wrapper.attributes('style');
    expect(style).toContain('top: 42px');
    expect(style).not.toContain('bottom');
    wrapper.unmount();
  });

  it.each([
    [448, 313, 'bottom: 137px', 'max-height: 311px'],
    [400, 210, 'bottom: 192px', 'max-height: 208px'],
    [400, 100, 'top: 126px', 'max-height: 274px'],
  ] as const)('limits the picker to the available side at viewport %s and anchor %s', (height, top, position, limit) => {
    vi.stubGlobal('innerHeight', height);
    const wrapper = mountPicker({ height: 24, left: 40, top, width: 200 });
    expect(wrapper.attributes('style')).toContain(position);
    expect(wrapper.attributes('style')).toContain(limit);
    wrapper.unmount();
  });

  it('updates the available height when scrolling and resizing with the picker open', async () => {
    vi.stubGlobal('innerHeight', 448);
    const wrapper = mountPicker({ height: 24, left: 40, top: 313, width: 200 });
    expect(wrapper.attributes('style')).toContain('max-height: 311px');
    await wrapper.setProps({ anchor: { height: 24, left: 40, top: 210, width: 200 } });
    window.dispatchEvent(new Event('scroll'));
    await wrapper.vm.$nextTick();
    expect(wrapper.attributes('style')).toContain('max-height: 212px');
    vi.stubGlobal('innerHeight', 400);
    window.dispatchEvent(new Event('resize'));
    await wrapper.vm.$nextTick();
    expect(wrapper.attributes('style')).toContain('max-height: 208px');
    wrapper.unmount();
  });

  it('offers a clear action for single-select with a current value', async () => {
    const wrapper = mountPicker({ height: 30, left: 40, top: 100, width: 200 }, { values: ['phase'] });

    await wrapper.find('.csv-cell-picker-clear').trigger('click');

    expect(wrapper.emitted('commit')).toEqual([[['']]]);
    wrapper.unmount();
  });

  it.each([undefined, 14])('focuses raw text at the requested position %s and confirms once', async (offsetX) => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      measureText: (text: string) => ({ width: text.length * 7 }),
    } as CanvasRenderingContext2D);
    const wrapper = mountPicker({ height: 24, left: 40, top: 100, width: 200 }, { rawValue: 'alpha', edit: { kind: 'raw', offsetX } });
    await flushPromises();
    const input = wrapper.get<HTMLInputElement>('.csv-cell-picker-search');
    expect(input.element.value).toBe('alpha');
    expect(input.element.selectionStart).toBe(offsetX === undefined ? 5 : 2);
    await input.setValue('  001, beta ');
    expect(wrapper.emitted('update-raw')).toEqual([['  001, beta ']]);
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    expect(wrapper.emitted('commit-raw')).toBeUndefined();
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('commit-raw')).toHaveLength(1);
    wrapper.unmount();
  });

  it('filters each raw list item and keeps candidate toggles in the same input', async () => {
    const wrapper = mountPicker(
      { height: 24, left: 40, top: 100, width: 200 },
      {
        multiple: true,
        rawValue: 'alpha, beta',
        edit: { kind: 'raw' },
        values: ['alpha', 'beta'],
        options: ['alpha', 'beta', 'gamma'].map((value) => ({ label: value, value })),
      },
    );
    expect(wrapper.findAll('.csv-cell-picker-option').map((option) => option.text())).toEqual(['alpha', 'beta']);
    await wrapper.findAll('.csv-cell-picker-option')[1]!.trigger('click');
    expect(wrapper.emitted('update')).toEqual([[['alpha']]]);
    await wrapper.setProps({ rawValue: 'alpha', values: ['alpha'] });
    expect(wrapper.get<HTMLInputElement>('.csv-cell-picker-search').element.value).toBe('alpha');
    await wrapper.setProps({ rawValue: '' });
    expect(wrapper.findAll('.csv-cell-picker-option')).toHaveLength(3);
    await wrapper.get('.csv-cell-picker-action').trigger('click');
    expect(wrapper.emitted('commit-raw')).toHaveLength(1);
    wrapper.unmount();
  });

  it('appends a numeric template to raw lists and selects only its text', async () => {
    const wrapper = mountPicker(
      { height: 24, left: 40, top: 100, width: 200 },
      {
        multiple: true,
        rawValue: 'alpha',
        edit: { kind: 'raw' },
        values: ['alpha'],
        options: [{ label: 'alpha*', value: 'alpha*', templateValue: 'alpha0' }],
        onUpdateRaw: (rawValue) => {
          void wrapper.setProps({ rawValue });
        },
      },
    );
    await wrapper.get('input').trigger('keydown', { key: 'ArrowDown' });
    await wrapper.get('input').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    const input = wrapper.get<HTMLInputElement>('.csv-cell-picker-search').element;
    expect(input.value).toBe('alpha, alpha0');
    expect(input.value.slice(input.selectionStart!, input.selectionEnd!)).toBe('alpha0');
    expect(wrapper.emitted('commit-raw')).toBeUndefined();
    wrapper.unmount();
  });

  it('hides the clear action when no value is selected', () => {
    const wrapper = mountPicker({ height: 30, left: 40, top: 100, width: 200 });

    expect(wrapper.find('.csv-cell-picker-clear').exists()).toBe(false);
    wrapper.unmount();
  });

  it('hides the clear action for multiple select', () => {
    const wrapper = mountPicker({ height: 30, left: 40, top: 100, width: 200 }, { multiple: true, values: ['a', 'b'] });

    expect(wrapper.find('.csv-cell-picker-clear').exists()).toBe(false);
    wrapper.unmount();
  });

  it.each([
    [false, ' B ', ['B']],
    [true, ' B ', ['A', 'B']],
    [false, 'Known label', ['known']],
    [true, 'Known label', ['A', 'known']],
  ] as const)('confirms search on Enter (multiple=%s, query=%s)', async (multiple, query, values) => {
    const wrapper = mountPicker(
      { height: 30, left: 40, top: 100, width: 200 },
      { values: ['A'], multiple, options: [{ label: 'Known label', value: 'known' }] },
    );
    const input = wrapper.get<HTMLInputElement>('.csv-cell-picker-search');
    await input.setValue('  ');
    await input.trigger('keydown', { key: 'Enter' });
    await input.setValue(query);
    await input.trigger('keydown', { key: 'Enter', isComposing: true });
    expect(wrapper.emitted('commit')).toBeUndefined();
    expect(wrapper.emitted('update')).toBeUndefined();
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted(multiple ? 'update' : 'commit')).toEqual([[values]]);
    expect(input.element.value).toBe('');
    wrapper.unmount();
  });

  it('puts a numeric template into search and confirms the edited value on Enter', async () => {
    const wrapper = mountPicker(
      { height: 30, left: 40, top: 100, width: 200 },
      {
        options: [
          {
            type: 'group',
            label: '数字标签',
            value: 'numeric',
            children: [{ label: 'kinetic* (动能)', value: 'kinetic*', templateValue: 'kinetic0' }],
          },
        ],
      },
    );
    await wrapper.get('.csv-cell-picker-option').trigger('click');
    const input = wrapper.get<HTMLInputElement>('.csv-cell-picker-search');
    expect(input.element.value).toBe('kinetic0');
    expect(wrapper.emitted('commit')).toBeUndefined();
    await input.setValue('kinetic12');
    await input.trigger('keydown', { key: 'Enter' });
    expect(wrapper.emitted('commit')).toEqual([[['kinetic12']]]);
    wrapper.unmount();
  });

  it('keeps the floating panel inside a narrow viewport and follows resizing', async () => {
    vi.stubGlobal('innerWidth', 480);
    const wrapper = mountPicker({ height: 30, left: 420, top: 100, width: 200 });
    expect(wrapper.attributes('style')).toContain('left: 176px');
    expect(wrapper.attributes('style')).toContain('width: 300px');
    vi.stubGlobal('innerWidth', 280);
    window.dispatchEvent(new Event('resize'));
    await wrapper.vm.$nextTick();
    expect(wrapper.attributes('style')).toContain('left: 4px');
    expect(wrapper.attributes('style')).toContain('width: 272px');
    wrapper.unmount();
  });
  it.each([false, true])('retains options and selection across independent group toggles (multiple=%s)', async (multiple) => {
    const options: SelectOption[] = ['alpha', 'beta'].map((value) => ({
      type: 'group',
      label: value,
      value,
      children: [{ label: value, value }],
    }));
    const wrapper = mountPicker({ height: 30, left: 40, top: 100, width: 200 }, { multiple, options, values: ['alpha'] });
    const groups = () => wrapper.findAll('.n-collapse-item');
    const option = groups()[0]!.get('.csv-cell-picker-option');
    expect(groups()[0]!.classes()).toContain('n-collapse-item--active');
    await groups()[0]!.get('.n-collapse-item-arrow').trigger('click');
    expect(groups()[0]!.classes()).not.toContain('n-collapse-item--active');
    expect(groups()[1]!.classes()).toContain('n-collapse-item--active');
    await groups()[0]!.get('.n-collapse-item__header-main').trigger('click');
    expect(groups()[0]!.get('.csv-cell-picker-option.selected').element).toBe(option.element);
    await wrapper.get('.csv-cell-picker-search').setValue('unconfirmed');
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(wrapper.emitted('commit')).toEqual([[['alpha']]]);
    wrapper.unmount();
  });

  it('uses the application Naive UI registration for grouped options', async () => {
    const wrapper = mount(CsvCellPicker, {
      props: {
        anchor: { height: 30, left: 40, top: 100, width: 200 },
        sessionId: 'sess-1',
        multiple: false,
        options: [{ type: 'group', label: 'Source', value: 'source', children: [{ label: 'Choice', value: 'choice' }] }],
        values: [],
      },
      global: { plugins: [installNaiveUi] },
    });
    await flushPromises();
    expect(wrapper.find('.csv-cell-picker-option').exists()).toBe(true);
    await wrapper.get('.csv-cell-picker-option').trigger('click');
    expect(wrapper.emitted('commit')).toEqual([[['choice']]]);
    wrapper.unmount();
  });
});
