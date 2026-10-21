import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import { mountCsvInputHost } from '@/test/csv-input-host';
import { editorUiStubs } from '@/test/ui-stubs';
import CsvGridEditorHost from './CsvGridEditorHost.vue';
import type { CsvGridColumn } from '@/domain/csv-editor/csv-grid-model';
import type { CsvSourceIndex } from '@/domain/schema/csv-source-options';
import type { CsvCellTarget } from '@/shared/types';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));

const sourceIndex: CsvSourceIndex = { optionsBySource: new Map(), valueIndexBySource: new Map(), valueSetsBySource: new Map() };
const column: CsvGridColumn = {
  className: 'schema-col-number',
  enumOptions: [],
  key: 'size',
  schema: { key: 'size', control: 'number' },
  widthPx: 100,
};

let fixture: ReturnType<typeof mountCsvInputHost> | null = null;
let anchor: HTMLDivElement;

beforeEach(() => {
  setActivePinia(createPinia());
  initializeSettingsStore(createSettingsFixture());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  anchor = document.createElement('div');
  document.body.append(anchor);
});

afterEach(() => {
  fixture?.host.unmount();
  fixture = null;
  anchor.remove();
  vi.unstubAllGlobals();
});

function mountHost(control: 'number' | 'text' = 'number') {
  fixture = mountCsvInputHost(
    CsvGridEditorHost,
    { global: { stubs: editorUiStubs }, attachTo: document.body },
    {
      target: {
        sessionId: 'sess-1',
        modRoot: 'M:/mod',
        table: 'ships',
        rowKey: 'ships:row:1',
        column: 'size',
      },
      row: { rowKey: 'ships:row:1', isComment: false, data: { size: 'MEDIUM' } },
      column: { ...column, schema: { key: 'size', control } },
      sourceIndex,
      anchorElement: anchor,
    },
  );
  return fixture.surface;
}

describe('CsvGridEditorHost', () => {
  it('teleports one editor into the active cell and keeps its focus', async () => {
    const host = mountHost();
    await host.vm.$nextTick();
    await host.vm.$nextTick();
    expect(anchor.querySelectorAll('.csv-cell-editor')).toHaveLength(1);
    expect(anchor.querySelector('input')).toBe(document.activeElement);
  });

  it('keeps pending input attached when the saved row key changes', async () => {
    const host = mountHost();
    await host.vm.$nextTick();
    const input = anchor.querySelector<HTMLInputElement>('input')!;
    input.value = 'later';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    fixture!.props.value = {
      ...fixture!.props.value,
      target: {
        sessionId: 'sess-1',
        modRoot: 'M:/mod',
        table: 'ships',
        rowKey: 'ships:row:9',
        column: 'size',
      } satisfies CsvCellTarget,
      row: { rowKey: 'ships:row:9', isComment: false, data: { size: 'MEDIUM' } },
    };
    await host.vm.$nextTick();
    await fixture!.inputs.commit();
    expect(fixture!.updates[0]).toEqual({
      target: { ...fixture!.target, rowKey: 'ships:row:9', column: 'size' },
      value: 'later',
    });
  });

  it('preserves the same text input and selection when the saved row identity changes', async () => {
    const host = mountHost('text');
    await host.vm.$nextTick();
    await host.vm.$nextTick();
    await host.vm.$nextTick();
    const input = anchor.querySelector<HTMLTextAreaElement>('textarea')!;
    input.value = 'unchanged raw';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.setSelectionRange(2, 6);
    fixture!.props.value = {
      ...fixture!.props.value,
      target: { ...fixture!.target, rowKey: 'ships:row:9', column: 'size' },
      row: { rowKey: 'ships:row:9', isComment: false, data: { size: 'MEDIUM' } },
    };
    await host.vm.$nextTick();
    expect(anchor.querySelector('textarea')).toBe(input);
    expect(input.value).toBe('unchanged raw');
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 6]);
    expect(document.activeElement).toBe(input);
    await fixture!.inputs.commit();
    expect(fixture!.updates[0]?.target.rowKey).toBe('ships:row:9');
    expect(fixture!.updates[0]?.value).toBe('unchanged raw');
  });

  it('commits the previous target and reuses one editor when another cell takes focus', async () => {
    const host = mountHost();
    await host.vm.$nextTick();
    const editor = anchor.querySelector('.csv-cell-editor');
    const input = anchor.querySelector<HTMLInputElement>('input')!;
    input.value = '0012';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture!.inputs.commit();
    const nextAnchor = document.createElement('div');
    document.body.append(nextAnchor);
    fixture!.props.value = {
      ...fixture!.props.value,
      target: { ...fixture!.target, rowKey: 'ships:row:2', column: 'size' },
      row: { rowKey: 'ships:row:2', isComment: false, data: { size: 'SMALL' } },
      anchorElement: nextAnchor,
    };
    await host.vm.$nextTick();
    expect(nextAnchor.querySelector('.csv-cell-editor')).toBe(editor);
    expect(nextAnchor.querySelector('input')).toBe(input);
    expect(input.value).toBe('SMALL');
    expect(document.activeElement).toBe(input);
    expect(fixture!.updates).toEqual([{ target: { ...fixture!.target, rowKey: 'ships:row:1', column: 'size' }, value: '0012' }]);
    input.value = 'later';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await fixture!.inputs.commit();
    expect(fixture!.updates[1]).toEqual({ target: { ...fixture!.target, rowKey: 'ships:row:2', column: 'size' }, value: 'later' });
    fixture!.props.value = { ...fixture!.props.value, target: null };
    await host.vm.$nextTick();
    expect(fixture!.inputs.commit()).toBeUndefined();
    nextAnchor.remove();
  });
});
