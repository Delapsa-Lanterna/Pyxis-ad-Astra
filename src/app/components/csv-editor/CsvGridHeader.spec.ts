import { afterEach, describe, expect, it } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import CsvGridHeader from '@/app/components/csv-editor/CsvGridHeader.vue';
import type { CsvGridColumn } from '@/domain/csv-editor/csv-grid-model';

const column: CsvGridColumn = {
  className: 'schema-col-text',
  enumOptions: [],
  key: 'id',
  schema: null,
  widthPx: 120,
};

let wrapper: VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.classList.remove('csv-column-resizing');
});

function mountHeader() {
  wrapper = mount(CsvGridHeader, {
    attachTo: document.body,
    props: { columns: [column] },
  });
  return wrapper;
}

describe('CsvGridHeader column resize', () => {
  it.each([0, 1, 2])('reserves only the left button for resizing (button %s)', (button) => {
    const mounted = mountHeader();
    const event = new MouseEvent('mousedown', { button, clientX: 100, bubbles: true, cancelable: true });
    mounted.get('.csv-th-resize').element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(button === 0);
    expect(document.body.classList.contains('csv-column-resizing')).toBe(button === 0);
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 145 }));
    expect(mounted.emitted('resize-column') ?? []).toEqual(button === 0 ? [['id', 165]] : []);
  });

  it('sets the document interaction class when resizing starts', async () => {
    const mounted = mountHeader();

    await mounted.get('.csv-th-resize').trigger('mousedown', { clientX: 100 });

    expect(document.body.classList.contains('csv-column-resizing')).toBe(true);
  });

  it('emits the resized column width while the pointer moves', async () => {
    const mounted = mountHeader();
    await mounted.get('.csv-th-resize').trigger('mousedown', { clientX: 100 });

    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 145 }));

    expect(mounted.emitted('resize-column')).toEqual([['id', 165]]);
  });

  it('clears the interaction class and listeners when resizing ends', async () => {
    const mounted = mountHeader();
    await mounted.get('.csv-th-resize').trigger('mousedown', { clientX: 100 });
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 145 }));

    document.dispatchEvent(new MouseEvent('mouseup'));
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 180 }));

    expect(document.body.classList.contains('csv-column-resizing')).toBe(false);
    expect(mounted.emitted('resize-column')).toEqual([['id', 165]]);
  });

  it('clears styles and listeners when unmounted during resizing', async () => {
    const mounted = mountHeader();
    await mounted.get('.csv-th-resize').trigger('mousedown', { clientX: 100 });

    mounted.unmount();
    wrapper = null;
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 145 }));

    expect(document.body.classList.contains('csv-column-resizing')).toBe(false);
    expect(mounted.emitted('resize-column')).toBeUndefined();
  });
});
