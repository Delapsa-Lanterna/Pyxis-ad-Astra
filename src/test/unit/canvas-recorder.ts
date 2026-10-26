export interface RecordedOp {
  op: string;
  alpha: number;
  composite: GlobalCompositeOperation;
  args: unknown[];
}
export interface Recorder {
  ctx: CanvasRenderingContext2D;
  ops: RecordedOp[];
  calls(op: string): RecordedOp[];
}
export function createCanvasRecorder(): Recorder {
  const ops: RecordedOp[] = [];
  const properties = [
    'globalAlpha',
    'globalCompositeOperation',
    'imageSmoothingEnabled',
    'strokeStyle',
    'fillStyle',
    'lineWidth',
    'lineJoin',
    'lineCap',
    'font',
    'textAlign',
    'textBaseline',
  ] as const;
  const stack: Array<Record<string, unknown>> = [];
  let dash: number[] = [];
  const record = (op: string, args: unknown[] = []) =>
    ops.push({ op, alpha: ctx.globalAlpha, composite: ctx.globalCompositeOperation, args });
  const ctx = {
    save: () => {
      stack.push({ ...Object.fromEntries(properties.map((key) => [key, ctx[key]])), dash: [...dash] });
      record('save');
    },
    restore: () => {
      const { dash: previous, ...state } = stack.pop()!;
      dash = previous as number[];
      Object.assign(ctx, state);
      record('restore');
    },
    beginPath: () => record('beginPath'),
    clearRect: (...args: unknown[]) => record('clearRect', args),
    setTransform: (...args: unknown[]) => record('setTransform', args),
    closePath: () => record('closePath'),
    stroke: () => record('stroke', [ctx.strokeStyle, ctx.lineWidth]),
    fill: () => record('fill', [ctx.fillStyle]),
    arc: (...args: unknown[]) => record('arc', args),
    rect: (...args: unknown[]) => record('rect', args),
    moveTo: (...args: unknown[]) => record('moveTo', args),
    lineTo: (...args: unknown[]) => record('lineTo', args),
    translate: (...args: unknown[]) => record('translate', args),
    rotate: (...args: unknown[]) => record('rotate', args),
    scale: (...args: unknown[]) => record('scale', args),
    quadraticCurveTo: (...args: unknown[]) => record('quadraticCurveTo', args),
    fillText: (...args: unknown[]) => record('fillText', args),
    strokeText: (...args: unknown[]) => record('strokeText', args),
    fillRect: (...args: unknown[]) => record('fillRect', args),
    drawImage: (...args: unknown[]) => record('drawImage', args),
    setLineDash: (value: number[]) => {
      dash = [...value];
      record('setLineDash', [value]);
    },
    getLineDash: () => [...dash],
    createLinearGradient: (...args: unknown[]) => {
      record('createLinearGradient', args);
      return { addColorStop: (...args: unknown[]) => record('addColorStop', args) };
    },
    canvas: { width: 200, height: 200 },
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: false,
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineJoin: '',
    lineCap: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    measureText: (text: string) => ({ width: text.length * 6 }),
    getImageData: () => ({ data: new Uint8ClampedArray(0) }),
    putImageData: (...args: unknown[]) => record('putImageData', args),
    clip: (...args: unknown[]) => record('clip', args),
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ops, calls: (op) => ops.filter((entry) => entry.op === op) };
}
