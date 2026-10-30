import type { ComponentInternalInstance, VNode } from 'vue';
import type { CsvGridModel } from '@/domain/csv-editor/csv-grid-model';

type AuditWindow = Window &
  typeof globalThis & {
    __TAURI_INTERNALS__: { invoke(command: string, args: unknown, ...rest: unknown[]): Promise<unknown> };
  };
type AppHost = HTMLElement & { __vue_app__: { _container: { _vnode: VNode } } };

export function installAudit() {
  const targetWindow = window as AuditWindow;
  const frame = () => new Promise((done) => requestAnimationFrame(done));
  const calls: { command: string; start: number; end: number | null }[] = [],
    invoke = targetWindow.__TAURI_INTERNALS__.invoke;
  targetWindow.__TAURI_INTERNALS__.invoke = function (command, args, ...rest) {
    const record: (typeof calls)[number] = { command, start: performance.now(), end: null };
    if (/^query_csv_|^query_resource_/.test(command)) calls.push(record);
    return invoke.call(this, command, args, ...rest).finally(() => {
      record.end = performance.now();
    });
  };
  let current: ComponentInternalInstance | undefined;
  function grid() {
    if (current && !current.isUnmounted) return current;
    function find(node: unknown): ComponentInternalInstance | undefined {
      const vnode = node as VNode | null | undefined;
      if (!vnode) return undefined;
      const component = vnode.component;
      if (component && (component.type as { __name?: string }).__name === 'CsvGrid') return component;
      if (component) {
        const found = find(component.subTree);
        if (found) return found;
      }
      if (Array.isArray(vnode.children))
        for (const child of vnode.children) {
          const found = find(child);
          if (found) return found;
        }
      if (vnode.suspense) return find(vnode.suspense.activeBranch);
      return undefined;
    }
    return (current = find((document.querySelector('#app') as AppHost).__vue_app__._container._vnode));
  }
  const nav = (label: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('.mod-navigation-button'))
      .find((button) => button.querySelector('.mod-navigation-button-label')?.textContent === label)!
      .click();

  function state(label: string) {
    if (document.querySelector('.page-title')?.textContent !== label) return;
    const component = grid(),
      panel = document.querySelector<HTMLElement>('.table-panel');
    if (!component || !panel) return;
    const model = component.props.model as CsvGridModel,
      columns = [];
    let offset = 16;
    for (const column of model.columns) {
      if (offset + column.widthPx > panel.scrollLeft + 16 && offset < panel.scrollLeft + panel.clientWidth) columns.push(column);
      offset += column.widthPx;
    }
    const first = Math.floor(panel.scrollTop / 24);
    const last = Math.min(model.rowKeys.length, Math.ceil((panel.scrollTop + panel.clientHeight - 24) / 24));
    if (!columns.length || first >= last) return;
    const mounted = new Map(
      Array.from(panel.querySelectorAll<HTMLElement>('[data-row-key]')).map((row) => [row.dataset.rowKey, row] as const),
    );
    for (const key of model.rowKeys.slice(first, last)) {
      const row = model.rowsByKey[key],
        element = mounted.get(key);
      if (!row || !element) return;
      const cells = new Map(
        Array.from(element.querySelectorAll<HTMLElement>('[data-column-key]')).map((cell) => [cell.dataset.columnKey, cell] as const),
      );
      for (const column of columns) {
        const cell = cells.get(column.key);
        if (!cell) return;
        const raw = String(row.data[column.key] ?? '');
        const source = column.schema?.source;
        const option = source ? model.sourceIndex.valueIndexBySource.get(source)?.get(raw)?.option : undefined;
        const text = cell.querySelector('.csv-cell-value')?.textContent?.trim();
        if (text !== undefined) {
          if (text !== raw.trim() && text !== option?.label?.trim()) return;
        } else if (
          Array.from(cell.querySelectorAll('.csv-cell-tag'))
            .map((tag) => tag.textContent!.trim())
            .join(',') !==
          raw
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .join(',')
        )
          return;
      }
    }
    return { columns: columns.length, rows: last - first, panel, model };
  }
  async function complete(label: string, start: number) {
    for (let attempt = 0; attempt < 1200; attempt++) {
      await frame();
      if (!state(label)) continue;
      await frame();
      const ready = state(label);
      if (ready) return { ms: performance.now() - start, rows: ready.rows, columns: ready.columns };
    }
    throw Error('Visible fields incomplete: ' + label);
  }
  async function auxiliary(label: string, start: number) {
    for (let attempt = 0; attempt < 600; attempt++) {
      await frame();
      if (calls.some((call) => call.command === 'query_csv_source_options' && call.start >= start && call.end === null)) continue;
      await frame();
      const namesMs = performance.now() - start;
      for (let imageFrame = 0; imageFrame < 600; imageFrame++) {
        const ready = state(label);
        if (!ready) {
          await frame();
          continue;
        }
        const panel = ready.panel.getBoundingClientRect();
        const canvases = Array.from(ready.panel.querySelectorAll<HTMLCanvasElement>('canvas[role=img]')).filter((canvas) => {
          const rect = canvas.getBoundingClientRect();
          return rect.bottom > panel.top + 24 && rect.top < panel.bottom && rect.right > panel.left + 16 && rect.left < panel.right;
        });
        if (
          canvases.every(
            (canvas) =>
              canvas.width === Math.round(parseFloat(canvas.style.width) * devicePixelRatio) &&
              canvas.height === Math.round(parseFloat(canvas.style.height) * devicePixelRatio),
          )
        ) {
          await frame();
          return { namesMs, imagesMs: performance.now() - start, images: canvases.length };
        }
        await frame();
      }
      throw Error('Visible thumbnails incomplete: ' + label);
    }
    throw Error('Reference names incomplete: ' + label);
  }
  async function measure(label: string, operation: string, round: number) {
    if (operation === 'switch') current = undefined;
    const panel = document.querySelector<HTMLElement>('.table-panel')!;
    let start = performance.now();
    if (operation === 'switch') nav(label);
    else {
      const maxTop = panel.scrollHeight - panel.clientHeight,
        maxLeft = panel.scrollWidth - panel.clientWidth;
      if (operation === 'tail') panel.scrollTop = maxTop;
      if (operation === 'top') panel.scrollTop = 0;
      if (operation === 'right') panel.scrollLeft = maxLeft;
      if (operation === 'left') panel.scrollLeft = 0;
      if (operation === 'vertical') panel.scrollTop = maxTop * (((round % 7) + 1) / 7);
      if (operation === 'horizontal') panel.scrollLeft = maxLeft * (((round % 7) + 1) / 7);
      if (operation === 'continuous') {
        for (let step = 0; step < 3; step++) {
          start = performance.now();
          panel.scrollTop = maxTop * (((round * 3 + step) % 11) / 10);
          panel.dispatchEvent(new Event('scroll'));
          await frame();
        }
      } else panel.dispatchEvent(new Event('scroll'));
    }
    const fields = (await complete(label, start))!;
    const extra = (await auxiliary(label, start))!;
    return { ...fields, ...extra };
  }
  function activateMod(mod: string) {
    const normalize = (path: string) =>
      path
        .replace(/^\\\\\?\\/, '')
        .replaceAll('\\', '/')
        .replace(/\/$/, '')
        .toLowerCase();
    const tab = Array.from(document.querySelectorAll<HTMLElement>('.mod-tab')).find((item) => normalize(item.title) === mod)!;
    tab.querySelector<HTMLButtonElement>('.mod-tab-activate')!.click();
  }
  return Object.assign(window, { __csvBench: { measure, frame, activateMod } }).__csvBench;
}
