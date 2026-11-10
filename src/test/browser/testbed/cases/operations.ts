import { nextTick } from 'vue';
import { settled } from '../../timing';
import type { Assertion } from '../../contracts';
export const recordAssertion = (assertions: Assertion[], name: string, actual: Assertion['actual'], expected: Assertion['expected']) => {
  assertions.push({ name, actual, expected, pass: actual === expected });
};
export async function scrollList(
  element: HTMLElement,
  count: number,
  rowHeight: number,
  selector: string,
  metrics: Record<string, number>,
) {
  const first = element.querySelector(selector),
    start = performance.now();
  for (const position of [count / 2, count - 20, 0, count - 20, 0]) {
    element.scrollTop = position * rowHeight;
    element.dispatchEvent(new Event('scroll'));
    await settled();
  }
  metrics.roundTrip = performance.now() - start;
  metrics.firstNodeRetained = Number(first === element.querySelector(selector));
  const traversal = performance.now(),
    step = Math.max(1, Math.floor(element.clientHeight / rowHeight));
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
