import type { CanvasState } from './use-canvas-state';
import type { CanvasTarget, EditorTarget } from '@/domain/editors/editor-types';

export function useCanvasSelection(
  state: Pick<CanvasState<unknown>, 'select' | 'clear' | 'inspectorLock'>,
  targets: (x: number, y: number) => CanvasTarget[],
  radius: (target: CanvasTarget) => number,
  nearestFallback = true,
) {
  const matches = (target: CanvasTarget | null, identity: EditorTarget | null) =>
    Boolean(target && identity && target.kind === identity.kind && target.i === identity.i && target.port === identity.port);
  function nearest(x: number, y: number) {
    const items = targets(x, y);
    const locked = items.find((target) => matches(target, state.inspectorLock.value)) ?? null;
    const nearby =
      items
        .filter((target) => !matches(target, state.inspectorLock.value) && target.distance <= radius(target))
        .sort((a, b) => a.distance - b.distance)[0] ?? null;
    return (
      nearby ??
      locked ??
      (nearestFallback && !state.inspectorLock.value ? (items.sort((a, b) => a.distance - b.distance)[0] ?? null) : null)
    );
  }
  function select(target: CanvasTarget) {
    state.select({ kind: target.kind, i: target.i, port: target.port });
  }
  function clear() {
    state.clear();
  }
  function byPointer(x: number, y: number) {
    const target = nearest(x, y);
    if (target) select(target);
    else clear();
    return target;
  }
  function byIdentity(identity: EditorTarget | null, x: number, y: number) {
    const target = identity ? (targets(x, y).find((target) => matches(target, identity)) ?? null) : null;
    if (target) select(target);
    return target;
  }
  return { nearest, select, clear, byPointer, byIdentity };
}
