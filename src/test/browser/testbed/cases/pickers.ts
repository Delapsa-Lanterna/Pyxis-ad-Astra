import { settled } from '../../timing';
import type { Assertion } from '../../contracts';
export async function exercisePicker(element: HTMLElement, assertions: Assertion[]) {
  const row = element.querySelector<HTMLElement>('[data-entry-id]')!;
  row.click();
  await settled();
  assertions.push({
    name: '候选项选择',
    actual: element.dataset.selectedId ?? '',
    expected: row.dataset.entryId!,
    pass: element.dataset.selectedId === row.dataset.entryId,
  });
}
