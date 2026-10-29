import { nextTick } from 'vue';
import type { createBrowserHost } from '../host';
import { settled, until } from '../scenarios/registry';
import type { Assertion } from '../contracts';

type Host = ReturnType<typeof createBrowserHost>;
export const recordAssertion = (assertions: Assertion[], name: string, actual: Assertion['actual'], expected: Assertion['expected']) => {
  assertions.push({ name, actual, expected, pass: actual === expected });
};
export function inputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function exercise(host: Host, element: HTMLElement, assertions: Assertion[], metrics: Record<string, number>) {
  const { scene } = host.model;
  if (['weapons', 'wings', 'hullmods'].includes(scene)) {
    const row = element.querySelector<HTMLElement>('[data-entry-id]')!;
    row.click();
    await settled();
    recordAssertion(assertions, '候选项选择', element.dataset.selectedId ?? '', row.dataset.entryId!);
    return;
  }
  let input: HTMLInputElement | HTMLTextAreaElement;
  const activate = performance.now();
  if (scene === 'csv') {
    element.querySelector<HTMLElement>('.csv-grid-row[data-row-key="ships:row:1"] [data-column-key="name"]')!.click();
    await until(() => Boolean(element.querySelector('.csv-cell-editor input,.csv-cell-text-editor textarea')), 'CSV 活动输入');
    input = element.querySelector('.csv-cell-editor input,.csv-cell-text-editor textarea')!;
  } else {
    input = [
      ...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        '#app input:not([readonly]):not([disabled]),.immersive-field-popover input,.immersive-field-popover textarea',
      ),
    ].find((candidate) => candidate.offsetWidth > 0 && candidate.type !== 'number')!;
  }
  metrics.activate = performance.now() - activate;
  const value = input.value + '_audit';
  const started = performance.now();
  inputValue(input, value);
  await nextTick();
  input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await settled();
  metrics.input = performance.now() - started;
  const commit = host.model.saveCount;
  const save = performance.now();
  await host.save();
  metrics.save = performance.now() - save;
  recordAssertion(assertions, '保存回执', host.model.saveCount > commit, true);
  if (scene === 'csv') recordAssertion(assertions, '保存值', String(host.model.rows[1]!.data.name), value);
  const model = host.model;
  await host.open(model, model.monitor.enabled);
  await settled();
  if (scene === 'csv') {
    await until(() => element.textContent!.includes(value), 'CSV 保存后重新读取');
    recordAssertion(assertions, '重新打开显示保存值', element.textContent!.includes(value), true);
  }
}

export async function scrollList(
  element: HTMLElement,
  count: number,
  rowHeight: number,
  selector: string,
  metrics: Record<string, number>,
) {
  const first = element.querySelector(selector);
  const start = performance.now();
  for (const position of [count / 2, count - 20, 0, count - 20, 0]) {
    element.scrollTop = position * rowHeight;
    element.dispatchEvent(new Event('scroll'));
    await settled();
  }
  metrics.roundTrip = performance.now() - start;
  metrics.firstNodeRetained = Number(first === element.querySelector(selector));
  const traversal = performance.now();
  const step = Math.max(1, Math.floor(element.clientHeight / rowHeight));
  for (let position = 0; position < count; position += step) {
    element.scrollTop = position * rowHeight;
    element.dispatchEvent(new Event('scroll'));
    await nextTick();
    await new Promise(requestAnimationFrame);
  }
  element.scrollTop = 0;
  element.dispatchEvent(new Event('scroll'));
  await settled();
  metrics.traverse = performance.now() - traversal;
  metrics.mountedRows = element.querySelectorAll(selector).length;
}
