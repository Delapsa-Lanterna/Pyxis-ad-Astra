import type { CanvasEditorState, CanvasTarget, CanvasTargetIdentity } from './use-canvas-editor';

export function useCanvasSelection<T>(
  state: CanvasEditorState<T>,
  targets: (x: number, y: number) => CanvasTarget[],
  radius: (target: CanvasTarget) => number,
  nearestFallback = true,
) {
  const matches = (target: CanvasTarget | null, identity: CanvasTargetIdentity | null) =>
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
    state.hovered.value = { kind: target.kind, i: target.i, port: target.port };
    state.selected.value = target.i;
    state.activeTarget.value = { kind: target.kind, i: target.i, port: target.port };
  }
  function clear() {
    state.hovered.value = null;
    state.selected.value = null;
    state.activeTarget.value = null;
  }
  function byPointer(x: number, y: number) {
    const target = nearest(x, y);
    if (target) select(target);
    else clear();
    return target;
  }
  function byIdentity(identity: CanvasTargetIdentity | null, x: number, y: number) {
    const target = identity ? (targets(x, y).find((target) => matches(target, identity)) ?? null) : null;
    if (target) select(target);
    return target;
  }
  return { nearest, select, clear, byPointer, byIdentity };
}
