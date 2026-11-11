import { createBrowserHost } from '../../host';
import { createScenario, releaseScenario } from '../scenarios';
import { immersiveTargets } from '../../../../../scripts/shared/performance-scenarios.mjs';
import { invoke, installBrowserModel } from '../../runtime/commands';
import { settled, until } from '../../timing';
import { recordAssertion } from './operations';
import type { JointEditQuery, JointEditSnapshot } from '@/shared/types';
import type { RoundResult, RunOptions } from '../../contracts';
import { jointObject } from '@/domain/joint-edit';

export function createImmersiveCase(element: HTMLElement, options: RunOptions) {
  const host = createBrowserHost(element);
  const target = immersiveTargets.find(({ kind }) => kind === options.scene)!;
  const model = createScenario(options);
  const query: JointEditQuery = {
    root: { sessionId: model.sessionId, modRoot: model.manifest.modRoot, kind: target.kind, id: target.id },
    rowKey: null,
    values: null,
    newSources: [],
    catalog: null,
  };
  let opened = false;
  let firstRead = 0;
  async function open() {
    installBrowserModel(model);
    const read = performance.now();
    await invoke<JointEditSnapshot>('query_joint_edit', { payload: query });
    firstRead = performance.now() - read;
    const first = performance.now();
    await host.open(model, options.monitor);
    await until(() => Boolean(element.querySelector('.immersive-actions button')), '沉浸式编辑器就绪');
    await settled();
    opened = true;
    return performance.now() - first;
  }
  async function sample(iteration: number, phase: RoundResult['phase']): Promise<RoundResult> {
    const result: RoundResult = { iteration, phase, metrics: {}, assertions: [] };
    if (!opened) {
      result.metrics.open = await open();
      result.metrics.firstRead = firstRead;
    }
    const began = performance.now();
    const snapshot = await invoke<JointEditSnapshot>('query_joint_edit', { payload: query });
    result.metrics.read = performance.now() - began;
    recordAssertion(result.assertions, '联合读取身份', snapshot.root.id, target.id);
    const row = [...element.querySelectorAll<HTMLElement>('.immersive-stat-row')].find(
      (row) => row.querySelector('.immersive-stat-row-label')?.textContent === target.label,
    )!;
    await until(() => Boolean(row.querySelector('button:not([disabled])')), '沉浸式字段就绪');
    const inputBegan = performance.now();
    row.querySelector<HTMLButtonElement>('button')!.click();
    await until(() => Boolean(document.querySelector('.immersive-field-popover input:not([disabled])')), '沉浸式字段输入');
    const input = [...document.querySelectorAll<HTMLInputElement>('.immersive-field-popover input:not([disabled])')].at(-1)!;
    const next = 'Measurement_' + target.kind + '_' + iteration;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settled();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    await until(() => element.textContent!.includes('未保存'), '沉浸式字段提交');
    result.metrics.input = performance.now() - inputBegan;
    const before = model.saveCount;
    const saved = performance.now();
    [...element.querySelectorAll<HTMLButtonElement>('.immersive-actions button')]
      .find((button) => button.textContent?.trim() === '保存')!
      .click();
    await until(
      () =>
        model.saveCount > before && [...element.querySelectorAll('[role=status]')].some((node) => node.textContent?.trim() === '已保存'),
      '沉浸式保存完成',
    );
    await settled();
    result.metrics.save = performance.now() - saved;
    const record = model.graph(target.kind, target.id).records.find((record) => record.source?.path.endsWith(target.file))!;
    recordAssertion(result.assertions, '保存字段值', String(jointObject(record.value)[target.field]), next);
    recordAssertion(result.assertions, '一次项目保存', model.saveCount - before, 1);
    return result;
  }
  async function close() {
    await host.close();
    releaseScenario(model);
    opened = false;
    if (host.remainingSessions || host.mediaStats.activeEntries || host.mediaStats.pending || element.childElementCount)
      throw Error('Immersive sample resources remain after close');
  }
  return { host, open, sample, close };
}
