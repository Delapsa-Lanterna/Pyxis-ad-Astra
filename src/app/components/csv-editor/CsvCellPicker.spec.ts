import { flushPromises, mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SelectOption } from '@/domain/schema/schema-options';
import CsvCellPicker from './CsvCellPicker.vue';
import { NCollapse, NCollapseItem } from 'naive-ui/es/collapse';
import { installNaiveUi } from '@/app/naive-ui.runtime';
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));

vi.mock('@/services/resource-media.service', () => ({
  resourceMediaDataUrl: vi.fn().mockReturnValue(undefined),
  subscribeResourceInvalidations: vi.fn(() => () => {}),
}));

function mountPicker(
  anchor: { height: number; left: number; top: number; width: number },
  props: { multiple?: boolean; options?: SelectOption[]; values?: string[] } = {},
) {
  return mount(CsvCellPicker, {
    props: { anchor, sessionId: 'sess-1', multiple: false, options: [], values: [], ...props },
    global: { plugins: [createPinia()], components: { NCollapse, NCollapseItem } },
  });
}

describe('CsvCellPicker placement', () => {
  beforeEach(() => {
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
    vi.unstubAllGlobals();
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

  it('offers a clear action for single-select with a current value', async () => {
    const wrapper = mountPicker({ height: 30, left: 40, top: 100, width: 200 }, { values: ['phase'] });

    await wrapper.find('.csv-cell-picker-clear').trigger('click');

    expect(wrapper.emitted('commit')).toEqual([[['']]]);
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
