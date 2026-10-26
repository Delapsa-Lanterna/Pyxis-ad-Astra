import { rotation, compare } from '../../../../scripts/browser/report.mjs';
import type { RoundResult, RunOptions, RunResult } from '../contracts';

export interface Variant {
  label: string;
  url: string;
  monitor: boolean;
  policy: 'code' | 'enabled' | 'disabled';
}

export async function comparePages(variants: Variant[], options: RunOptions, progress: (text: string) => void) {
  const entries = variants.map((variant) => {
    const frame = document.createElement('iframe');
    frame.className = 'testbed-comparison-frame';
    frame.title = variant.label;
    const endpoint = new URL(variant.url);
    endpoint.searchParams.set('worker', '1');
    frame.src = endpoint.href;
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    let sequence = 0;
    let ready: () => void;
    const loaded = new Promise<void>((resolve) => (ready = resolve));
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== endpoint.origin) return;
      if (event.data.type === 'testbed-ready') ready();
      if (event.data.type === 'testbed-result') {
        const request = pending.get(event.data.id)!;
        pending.delete(event.data.id);
        if (event.data.error) request.reject(Error(event.data.error));
        else request.resolve(event.data.value);
      }
    };
    window.addEventListener('message', receive);
    document.body.append(frame);
    async function call<T>(
      method: 'sample' | 'report',
      samples: RoundResult[] = [],
      iteration = 0,
      phase: RoundResult['phase'] = 'measurement',
    ) {
      await loaded;
      const id = ++sequence;
      const result = new Promise<unknown>((resolve, reject) => pending.set(id, { resolve, reject }));
      frame.contentWindow!.postMessage(
        { type: 'testbed-request', id, method, samples, iteration, phase, options: { ...options, monitor: variant.monitor } },
        endpoint.origin,
      );
      return (await result) as T;
    }
    return {
      variant,
      frame,
      call,
      samples: [] as RoundResult[],
      close() {
        window.removeEventListener('message', receive);
        frame.remove();
      },
    };
  });
  const order: { iteration: number; phase: string; variant: string }[] = [];
  try {
    for (let iteration = 0; iteration < options.warmup + options.rounds; iteration++) {
      for (const index of rotation(entries.length, iteration)) {
        const entry = entries[index]!;
        for (const other of entries) other.frame.hidden = other !== entry;
        entry.frame.contentWindow!.focus();
        const phase = iteration < options.warmup ? 'warmup' : 'measurement';
        progress(`${entry.variant.label} · ${phase} ${iteration + 1}/${options.warmup + options.rounds}`);
        entry.samples.push(await entry.call<RoundResult>('sample', [], iteration, phase));
        order.push({ iteration, phase, variant: entry.variant.label });
      }
      if (entries.some((entry) => entry.samples.at(-1)!.error)) break;
    }
    const runs: RunResult[] = [];
    for (const entry of entries) {
      const run = await entry.call<RunResult>('report', entry.samples);
      run.environment.variant = entry.variant.label;
      runs.push(run);
    }
    const comparisons = runs.slice(1).map((run, index) => {
      const policy = entries[index + 1]!.variant.policy;
      return compare(runs[policy === 'enabled' ? index : 0]!, run, policy);
    });
    return { runs, order, comparisons, pass: runs.every((run) => run.pass) && comparisons.flat().every((item) => item.pass) };
  } finally {
    for (const entry of entries) entry.close();
  }
}
