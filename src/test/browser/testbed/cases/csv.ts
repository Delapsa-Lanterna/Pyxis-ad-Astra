import { nextTick } from 'vue';
import type { createBrowserHost } from '../../host';
import type { Assertion } from '../../contracts';
import { settled, until } from '../../timing';

export async function exerciseCsv(
  host: ReturnType<typeof createBrowserHost>,
  element: HTMLElement,
  assertions: Assertion[],
  metrics: Record<string, number>,
) {
  const activate = performance.now();
  element
    .querySelector<HTMLElement>('.csv-grid-row[data-row-key="ships:row:1"] [data-column-key="name"]')!
    .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  await until(() => Boolean(document.querySelector('.csv-cell-editor input,.csv-cell-text-editor textarea')), 'CSV 活动输入');
  const input = document.querySelector<HTMLInputElement | HTMLTextAreaElement>('.csv-cell-editor input,.csv-cell-text-editor textarea')!;
  metrics.activate = performance.now() - activate;
  const value = input.value + '_audit',
    began = performance.now();
  Object.getOwnPropertyDescriptor(
    input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    'value',
  )!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await nextTick();
  input.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await settled();
  metrics.input = performance.now() - began;
  const commit = host.model.saveCount,
    saved = performance.now();
  await host.save();
  metrics.save = performance.now() - saved;
  assertions.push(
    { name: '保存回执', pass: host.model.saveCount > commit, actual: host.model.saveCount > commit, expected: true },
    {
      name: '保存值',
      actual: String(host.model.rows[1]!.data.name),
      expected: value,
      pass: String(host.model.rows[1]!.data.name) === value,
    },
  );
  await host.open(host.model, host.model.monitor.enabled);
  await settled();
  await until(() => element.textContent!.includes(value), 'CSV 保存后重新读取');
  assertions.push({
    name: '重新打开显示保存值',
    actual: element.textContent!.includes(value),
    expected: true,
    pass: element.textContent!.includes(value),
  });
}
