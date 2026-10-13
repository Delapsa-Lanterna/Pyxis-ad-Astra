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
  const stack: Array<{ alpha: number; composite: GlobalCompositeOperation }> = [];
  const record = (op: string, args: unknown[] = []) =>
    ops.push({ op, alpha: ctx.globalAlpha, composite: ctx.globalCompositeOperation, args });
  const ctx = {
    save: () => {
      stack.push({ alpha: ctx.globalAlpha, composite: ctx.globalCompositeOperation });
      record('save');
    },
    restore: () => {
      const saved = stack.pop()!;
      ctx.globalAlpha = saved.alpha;
      ctx.globalCompositeOperation = saved.composite;
      record('restore');
    },
    beginPath: () => record('beginPath'),
    clearRect: (...args: unknown[]) => record('clearRect', args),
    closePath: () => record('closePath'),
    stroke: () => record('stroke', [ctx.strokeStyle, ctx.lineWidth]),
    fill: () => record('fill', [ctx.fillStyle]),
    arc: (...args: unknown[]) => record('arc', args),
    rect: (...args: unknown[]) => record('rect', args),
    moveTo: (...args: unknown[]) => record('moveTo', args),
    lineTo: (...args: unknown[]) => record('lineTo', args),
    translate: (...args: unknown[]) => record('translate', args),
    rotate: (...args: unknown[]) => record('rotate', args),
    quadraticCurveTo: () => record('quadraticCurveTo'),
    fillText: (...args: unknown[]) => record('fillText', args),
    strokeText: (...args: unknown[]) => record('strokeText', args),
    fillRect: () => record('fillRect'),
    drawImage: (...args: unknown[]) => record('drawImage', args),
    setLineDash: () => record('setLineDash'),
    createLinearGradient: (...args: unknown[]) => {
      record('createLinearGradient', args);
      return { addColorStop: () => record('addColorStop') };
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
  } as unknown as CanvasRenderingContext2D;
  return { ctx, ops, calls: (op) => ops.filter((entry) => entry.op === op) };
}
