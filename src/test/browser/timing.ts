import { nextTick } from 'vue';
export const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
export async function settled() {
  await nextTick();
  await frame();
  await frame();
}
export async function until(predicate: () => boolean, label: string) {
  const deadline = performance.now() + 15000;
  while (!predicate()) {
    if (performance.now() > deadline) throw Error(`等待超时：${label}`);
    await frame();
  }
}
