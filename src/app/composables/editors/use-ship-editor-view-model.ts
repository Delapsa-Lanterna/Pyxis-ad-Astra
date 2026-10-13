import {
  shiftRelativePosition,
  shipEngineSize,
  appendBayPort,
  bayPorts,
  engineWithDefaults,
  formatLaunchBayId,
  formatWeaponSlotId,
  launchBayWithDefaults,
  nextFormattedId,
  removeBayPort,
  updateBayPort,
  weaponSlotWithDefaults,
} from '@/domain/editors/lib/ship-slots';
import { computed, ref, watch, type EmitFn, type ShallowRef } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import type { RowData, EditContext } from '@/shared/types';
import { arr, deepClone, num, str } from '@/shared/lib/starsector';
import { normalizeShipSpec } from '@/domain/editors/lib/normalize';
import {
  distance,
  nearestBoundsSegment,
  shipAbsoluteToRelative,
  pointAngle,
  pointArc,
  shipCanvasPoint,
  shipPointFromCanvas,
  shipRelativeToAbsolute,
} from '@/domain/editors/lib/geometry';

import {
  createCanvasEditorState,
  useCanvasEditor,
  type CanvasInspectorReveal,
  type CanvasModifiers,
  type CanvasPick,
  type CanvasTarget,
} from '@/app/composables/canvas/use-canvas-editor';
import { useCanvasViewport } from '@/app/composables/canvas/use-canvas-viewport';
import { useResourceReference } from '@/app/composables/editors/use-resource-reference';
import { snapToStep } from '@/domain/editors/lib/editor-constants';
import {
  findMirrorBoundIndex,
  findMirrorEngineIndex,
  findMirrorWeaponSlotIndex,
  mirrorAngleDeg,
  mirrorBayPort,
  mirrorEngineForAdd,
  mirrorLateral,
  mirrorOffsetPoint,
  mirrorWeaponSlotForAdd,
  MIRROR_EPSILON,
} from '@/domain/editors/lib/mirror';

import { renderShipScene } from '@/app/renderers/editors/ship-scene';
import type { ShipEditorMode, ShipHoverPreview } from '@/domain/editors/editor-types';
import { useCanvasPalette } from '@/app/composables/canvas/use-canvas-palette';
import { useEditorImages } from '@/app/composables/editors/use-editor-images';

export interface ShipEditorProps {
  modRoot: string;
  sessionId: string;
  hullId: string;
  ship: RowData;
  spriteData?: string;
  editContext: EditContext | null;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  externalUpdateNotice: string;
}
export type ShipEditorEvents = { close: []; 'save-requested': []; 'draft-changed': [ship: RowData]; 'load-external': [] };

export function useShipEditorViewModel(
  props: Readonly<ShipEditorProps>,
  emit: EmitFn<ShipEditorEvents>,
  elements: {
    editorWindowRef: Readonly<ShallowRef<HTMLElement | null>>;
    stageRef: Readonly<ShallowRef<HTMLElement | null>>;
    canvasRef: Readonly<ShallowRef<HTMLCanvasElement | null>>;
  },
) {
  const { editorWindowRef, stageRef, canvasRef } = elements;

  const feedback = useAppFeedback();
  const { pickModImageReference } = useResourceReference();
  const localShip = ref<RowData>(normalizeShipSpec(props.ship));
  const mode = ref<ShipEditorMode>('overview');
  const selectedPort = ref<number | null>(null);
  const expandedSections = ref(['basic']);
  const spriteSize = ref({ width: 0, height: 0 });
  const viewport = useCanvasViewport(canvasRef, 1, 10);
  const { scale } = viewport;
  const editorState = createCanvasEditorState<ShipHoverPreview>();
  const { activeTarget, clearPreview, dragKind, hoverPreview, hovered, inspectorLock, mirrorMode, mirrorPair, selected } = editorState;
  const canvas = useCanvasEditor({
    context: computed(() => props.editContext),
    stageRef,
    windowRef: editorWindowRef,
    expandedSections,
    viewport,
    state: editorState,
    hooks: {
      value: localShip,
      sourceValue: () => props.ship,
      onDraftMutated: (value) => emit('draft-changed', value),
      normalize: normalizeShipSpec,
      deleteSelected,
      shortcutKeys: {
        p: () => setMode('overview'),
        c: () => setMode('ranges'),
        b: () => setMode('bounds'),
        w: () => setMode('weapon'),
        l: () => setMode('launchBay'),
        e: () => setMode('engine'),
      },
      inspectorReveal: (): CanvasInspectorReveal | null => {
        const section = modeToSection[mode.value];
        const selector = currentInspectorTargetSelector();
        if (!section || !selector) return null;
        return { section, selector, lock: activeTarget.value ? { ...activeTarget.value } : null };
      },
      selectableTargets,
      hitRadius: targetHitRadius,
      actionDown,
      selectForDown,
      resolveDragKind,
      captureMirrorPair,
      applyDrag: updateInteraction,
      applyMirrorDrag: applyMirrorInteraction,
      previewTakesOver: shouldPauseAutoSnap,
      computePreview,
      onReady: draw,
      draw,
    },
  });
  const {
    runAction,
    beginField,
    fieldBlur,
    fieldKey,
    commitEdit,
    onDown,
    onExpandedSectionsUpdate,
    onLeave,
    onMove,
    onUp,
    onWheel,
    beginEdit,
  } = canvas;
  const modes = [
    { shortcut: 'P', value: 'overview', label: '总览' },
    { shortcut: 'C', value: 'ranges', label: '范围' },
    { shortcut: 'B', value: 'bounds', label: '边界' },
    { shortcut: 'W', value: 'weapon', label: '武器' },
    { shortcut: 'L', value: 'launchBay', label: '甲板' },
    { shortcut: 'E', value: 'engine', label: '引擎' },
  ] as const;
  type InspectorSection = 'basic' | 'sprite' | 'props' | 'weapons' | 'launchBays' | 'engines' | 'bounds' | 'advanced' | 'builtins';
  const modeToSection: Record<typeof mode.value, InspectorSection | null> = {
    overview: null,
    ranges: 'props',
    bounds: 'bounds',
    weapon: 'weapons',
    launchBay: 'launchBays',
    engine: 'engines',
  };
  const modeFooterNotes: Record<typeof mode.value, string> = {
    overview: '仅查看',
    ranges: '左键 拖动中心或护盾 | Shift+左键 改碰撞半径 | Ctrl+左键 改护盾半径 | T 打开中心与护盾',
    bounds: '左键 拖动边界点 | Shift+左键 追加边界点 | Ctrl+左键 插入最近边段 | T 打开碰撞边界',
    weapon: '左键 旋转角度 | Shift+左键 复制武器槽 | Ctrl+左键 移动位置 | Alt+左键 调整射角 | T 打开武器槽',
    launchBay: '左键 选中港口 | 拖动 移动港口 | Ctrl+左键 新建甲板 | Shift+左键 为选中甲板新增港口 | T 打开甲板',
    engine: '左键 旋转角度 | Shift+左键 复制引擎 | Ctrl+左键 移动位置 | Alt+左键 调整宽高 | T 打开引擎',
  };
  const footerNote = computed(() => {
    const mirrorBadge = mirrorMode.value ? '（镜像模式）' : '';
    const mirrorHint = mirrorMode.value ? ' | 空格 关闭镜像' : ' | 空格 开启镜像';
    return `右键 拖动画布 | 滚轮 缩放 | Ctrl+Z 撤销 | Ctrl+Shift+Z 重做${mirrorBadge}\n${modeFooterNotes[mode.value]}${mirrorHint}`;
  });

  const weaponSlots = computed<RowData[]>(() =>
    Array.isArray(localShip.value.weaponSlots) ? (localShip.value.weaponSlots as RowData[]) : [],
  );
  const normalWeaponSlots = computed(() =>
    weaponSlots.value.map((slot, index) => ({ index, slot })).filter((item) => str(item.slot.type).toUpperCase() !== 'LAUNCH_BAY'),
  );
  const launchBaySlots = computed(() =>
    weaponSlots.value.map((slot, index) => ({ index, slot })).filter((item) => str(item.slot.type).toUpperCase() === 'LAUNCH_BAY'),
  );
  const engineSlots = computed<RowData[]>(() =>
    Array.isArray(localShip.value.engineSlots) ? (localShip.value.engineSlots as RowData[]) : [],
  );
  const bounds = computed<number[]>(() => (Array.isArray(localShip.value.bounds) ? (localShip.value.bounds as number[]) : []));
  const boundPairs = computed(() => Array.from({ length: Math.floor(bounds.value.length / 2) }));
  const center = computed(() => arr(localShip.value.center, [0, 0]));
  const shieldCenter = computed(() => arr(localShip.value.shieldCenter, [0, 0]));
  const moduleAnchor = computed(() => arr(localShip.value.moduleAnchor, [0, 0]));
  const selectedSlot = computed(() => (selected.value === null ? null : weaponSlots.value[selected.value]));
  const selectedEngine = computed(() => (selected.value === null ? null : engineSlots.value[selected.value]));
  const slotLoc = computed(() => arr(selectedSlot.value?.locations, [0, 0]));
  const selectedBayPorts = computed(() => bayPorts(selectedSlot.value?.locations));
  const engineLoc = computed(() => arr(selectedEngine.value?.location, [0, 0]));
  const builtInMods = computed({
    get: () => (Array.isArray(localShip.value.builtInMods) ? (localShip.value.builtInMods as string[]) : []),
    set: (v) => {
      localShip.value.builtInMods = v;
      commitEdit();
    },
  });
  const builtInWings = computed({
    get: () => (Array.isArray(localShip.value.builtInWings) ? (localShip.value.builtInWings as string[]) : []),
    set: (v) => {
      localShip.value.builtInWings = v;
      commitEdit();
    },
  });

  function setMode(value: typeof mode.value) {
    mode.value = value;
    selected.value = null;
    hovered.value = null;
    activeTarget.value = null;
    inspectorLock.value = null;
    clearPreview();
    draw();
  }
  function canvasCenter() {
    return viewport.center();
  }
  function shipCenterPoint() {
    return shipToCanvas(center.value);
  }
  function shipToCanvas(loc: number[]) {
    return shipCanvasPoint(loc, canvasCenter(), scale.value);
  }
  function relativeToCanvas(loc: number[]) {
    return shipToCanvas(relativeToAbsolute(loc));
  }
  function canvasToShip(x: number, y: number): [number, number] {
    const point = rawCanvasToShip(x, y);
    return [snapToStep(point[0]), snapToStep(point[1])];
  }
  function rawCanvasToShip(x: number, y: number): [number, number] {
    return shipPointFromCanvas({ x, y }, canvasCenter(), scale.value);
  }
  function canvasToRelative(x: number, y: number): [number, number] {
    const point = canvasToShip(x, y);
    return absoluteToRelative(point);
  }
  function relativeToAbsolute(loc: number[]): [number, number] {
    return shipRelativeToAbsolute(loc, center.value);
  }
  function absoluteToRelative(loc: number[]): [number, number] {
    const point = shipAbsoluteToRelative(loc, center.value);
    return [snapToStep(point[0]), snapToStep(point[1])];
  }
  function targetKindAt(mx: number, my: number): string | null {
    if (mode.value !== 'ranges') return activeTarget.value?.kind || null;
    const raw = rawCanvasToShip(mx, my);
    const shieldDistance = distance(raw, relativeToAbsolute(shieldCenter.value));
    const centerDistance = distance(raw, center.value);
    if (distance([0, 0], shieldCenter.value) === 0 && shieldDistance === centerDistance) return 'shield';
    return shieldDistance < centerDistance ? 'shield' : 'center';
  }
  function loadSprite() {
    spriteSize.value = { width: 0, height: 0 };
    images.reload();
    draw();
  }
  const canSyncSpriteSize = computed(() => spriteSize.value.width > 0 && spriteSize.value.height > 0);
  function syncSpriteSize() {
    if (!canSyncSpriteSize.value) return;
    beginEdit();
    localShip.value.width = spriteSize.value.width;
    localShip.value.height = spriteSize.value.height;
    commitEdit();
    draw();
  }

  function currentInspectorTargetSelector(): string {
    if (mode.value === 'weapon') return selected.value !== null ? `[data-inspector-target="weapon-${selected.value}"]` : '';
    if (mode.value === 'launchBay') return selected.value !== null ? `[data-inspector-target="launchBay-${selected.value}"]` : '';
    if (mode.value === 'engine') return selected.value !== null ? `[data-inspector-target="engine-${selected.value}"]` : '';
    if (mode.value === 'bounds') return selected.value !== null ? `[data-inspector-target="bound-${selected.value}"]` : '';
    if (mode.value === 'ranges') {
      if (activeTarget.value?.kind === 'center') return '[data-inspector-field="center-x"]';
      if (activeTarget.value?.kind === 'shield') return '[data-inspector-field="shield-x"]';
    }
    return '';
  }

  function currentRangePreview(coord: number[], modifiers: CanvasModifiers) {
    if (modifiers.shiftKey) return { kind: 'collisionRadius' as const, radius: Math.max(0, Math.round(distance(coord, center.value))) };
    if (modifiers.ctrlKey)
      return { kind: 'shieldRadius' as const, radius: Math.max(0, Math.round(distance(coord, relativeToAbsolute(shieldCenter.value)))) };
    return null;
  }
  function previewWeaponState(coord: number[], modifiers: CanvasModifiers, mx: number, my: number) {
    const relativeCoord = absoluteToRelative(coord);
    if (modifiers.altKey && selectedSlot.value) {
      return {
        kind: 'weaponArc' as const,
        arc: pointArc(relativeToAbsolute(slotLoc.value), rawCanvasToShip(mx, my), num(selectedSlot.value.angle, 0)),
      };
    }
    if (modifiers.shiftKey) {
      const source = selectedSlot.value ? deepClone(selectedSlot.value) : {};
      return {
        kind: 'weaponCopy' as const,
        coord: relativeCoord,
        slot: weaponSlotWithDefaults(source, nextWeaponSlotId(), relativeCoord),
      };
    }
    if (modifiers.ctrlKey && selectedSlot.value) {
      return { kind: 'weaponMove' as const, coord: relativeCoord, slot: { ...deepClone(selectedSlot.value), locations: relativeCoord } };
    }
    return null;
  }
  function previewLaunchBayState(coord: number[], modifiers: CanvasModifiers) {
    if (modifiers.ctrlKey) {
      const relativeCoord = absoluteToRelative(coord);
      const source = selectedSlot.value ? deepClone(selectedSlot.value) : {};
      return {
        kind: 'launchBayAdd' as const,
        coord: relativeCoord,
        slot: launchBayWithDefaults(source, nextLaunchBayId(), relativeCoord),
      };
    }
    if (modifiers.shiftKey && selected.value !== null) {
      return { kind: 'launchBayPortAdd' as const, coord: absoluteToRelative(coord) };
    }
    return null;
  }
  function previewEngineState(coord: number[], modifiers: CanvasModifiers, mx: number, my: number) {
    const relativeCoord = absoluteToRelative(coord);
    if (modifiers.altKey && selectedEngine.value) {
      const { length, width } = engineSizeFromPointer(mx, my);
      return { kind: 'engineSize' as const, length, width };
    }
    if (modifiers.shiftKey) {
      const source = selectedEngine.value ? deepClone(selectedEngine.value) : {};
      return {
        kind: 'engineCopy' as const,
        coord: relativeCoord,
        engine: engineWithDefaults(source, relativeCoord),
      };
    }
    if (modifiers.ctrlKey && selectedEngine.value) {
      return { kind: 'engineMove' as const, coord: relativeCoord, engine: { ...deepClone(selectedEngine.value), location: relativeCoord } };
    }
    return null;
  }
  function previewBoundsState(coord: number[], modifiers: CanvasModifiers) {
    const relativeCoord = absoluteToRelative(coord);
    if (modifiers.shiftKey) return { kind: 'boundAppend' as const, coord: relativeCoord };
    if (modifiers.ctrlKey)
      return { kind: 'boundInsert' as const, coord: relativeCoord, insertAfter: nearestBoundsSegmentIndex(relativeCoord) };
    return null;
  }
  function computePreview(mx: number, my: number, modifiers: CanvasModifiers): ShipHoverPreview {
    const coord = canvasToShip(mx, my);
    if (mode.value === 'ranges') return currentRangePreview(coord, modifiers);
    if (mode.value === 'bounds') return previewBoundsState(coord, modifiers);
    if (mode.value === 'weapon') return previewWeaponState(coord, modifiers, mx, my);
    if (mode.value === 'launchBay') return previewLaunchBayState(coord, modifiers);
    if (mode.value === 'engine') return previewEngineState(coord, modifiers, mx, my);
    return null;
  }
  function shouldPauseAutoSnap(modifiers: CanvasModifiers) {
    if (mode.value === 'ranges') return modifiers.shiftKey || modifiers.ctrlKey;
    if (mode.value === 'bounds') return modifiers.shiftKey || modifiers.ctrlKey;
    if (mode.value === 'weapon') return modifiers.altKey || modifiers.ctrlKey || modifiers.shiftKey;
    if (mode.value === 'launchBay') return modifiers.shiftKey || modifiers.ctrlKey;
    if (mode.value === 'engine') return modifiers.altKey || modifiers.ctrlKey || modifiers.shiftKey;
    return false;
  }
  function formatCoord(coord: number[]) {
    return `${(coord[0] || 0).toFixed(1)}, ${(coord[1] || 0).toFixed(1)}`;
  }
  function cursorLabel(coord: number[]): string {
    if (dragKind.value === 'weaponAngle' && selectedSlot.value) return `${Math.round(num(selectedSlot.value.angle, 0))}°`;
    if (dragKind.value === 'weaponArc' && selectedSlot.value) return `${Math.round(num(selectedSlot.value.arc, 0))}°`;
    if (hoverPreview.value?.kind === 'weaponArc') return `${Math.round(hoverPreview.value.arc)}°`;
    if (dragKind.value === 'engineAngle' && selectedEngine.value) return `${Math.round(num(selectedEngine.value.angle, 0))}°`;
    if (dragKind.value === 'engineSize' && selectedEngine.value)
      return `${Math.round(num(selectedEngine.value.length, 0))} x ${Math.round(num(selectedEngine.value.width, 0))}`;
    if (hoverPreview.value?.kind === 'engineSize')
      return `${Math.round(hoverPreview.value.length)} x ${Math.round(hoverPreview.value.width)}`;
    if (mode.value === 'overview' || mode.value === 'ranges') return formatCoord(coord);
    return formatCoord(absoluteToRelative(coord));
  }
  function cursorMarker(mx: number, my: number) {
    const coord = canvasToShip(mx, my);
    return { point: shipToCanvas(coord), label: cursorLabel(coord) };
  }

  function draw() {
    const c = canvasRef.value;
    if (!c) return;
    const pointer = canvas.pointerState();
    const sprite = images.images.get('sprite') ?? null;
    renderShipScene(c.getContext('2d')!, {
      base: {
        ...viewport.size(),
        center: viewport.center(),
        scale: scale.value,
        palette: palette.value,
        mirrorY: mirrorMode.value && ['weapon', 'launchBay', 'engine', 'bounds'].includes(mode.value) ? shipCenterPoint().y : null,
        cursor: pointer.inside ? cursorMarker(pointer.x, pointer.y) : null,
      },
      ship: localShip.value,
      mode: mode.value,
      bounds: bounds.value,
      center: center.value,
      shieldCenter: shieldCenter.value,
      slots: weaponSlots.value,
      engines: engineSlots.value,
      selected: selected.value,
      selectedPort: selectedPort.value,
      hovered: hovered.value,
      dragKind: dragKind.value,
      preview: hoverPreview.value,
      mirrorMode: mirrorMode.value,
      selectedSlot: selectedSlot.value,
      selectedEngine: selectedEngine.value,
      slotLoc: slotLoc.value,
      engineLoc: engineLoc.value,
      sprite,
      tintedSprite: sprite ? images.tintImage(sprite, [127, 127, 127]) : null,
    });
  }
  function targetHitRadius(target: CanvasTarget) {
    if (target.kind === 'launchBayPort') return 16;
    if (target.kind === 'engine') return 28;
    if (target.kind === 'center' || target.kind === 'shield') return 30;
    return 26;
  }
  function selectableTargets(mx: number, my: number): CanvasTarget[] {
    const targets: CanvasTarget[] = [];
    if (mode.value === 'overview') return targets;
    if (mode.value === 'weapon' || mode.value === 'launchBay') {
      for (let i = weaponSlots.value.length - 1; i >= 0; i--) {
        const slot = weaponSlots.value[i];
        if (!slot) continue;
        const isLaunchBay = str(slot.type).toUpperCase() === 'LAUNCH_BAY';
        if (mode.value === 'weapon' && isLaunchBay) continue;
        if (mode.value === 'launchBay') {
          if (!isLaunchBay) continue;
          const ports = bayPorts(slot.locations);
          for (let port = ports.length - 1; port >= 0; port--) {
            const p = relativeToCanvas(ports[port] ?? [0, 0]);
            targets.push({ kind: 'launchBayPort', i, port, distance: Math.hypot(mx - p.x, my - p.y) });
          }
          continue;
        }
        const p = relativeToCanvas(arr(slot.locations, [0, 0]));
        targets.push({ kind: 'weapon', i, distance: Math.hypot(mx - p.x, my - p.y) });
      }
    }
    if (mode.value === 'engine') {
      for (let i = engineSlots.value.length - 1; i >= 0; i--) {
        const engine = engineSlots.value[i];
        if (!engine) continue;
        const p = relativeToCanvas(arr(engine.location, [0, 0]));
        targets.push({ kind: 'engine', i, distance: Math.hypot(mx - p.x, my - p.y) });
      }
    }
    if (mode.value === 'bounds') {
      for (let i = 0; i < bounds.value.length; i += 2) {
        const p = relativeToCanvas([bounds.value[i] ?? 0, bounds.value[i + 1] ?? 0]);
        targets.push({ kind: 'bound', i: i / 2, distance: Math.hypot(mx - p.x, my - p.y) });
      }
    }
    if (mode.value === 'ranges') {
      const sp = relativeToCanvas(shieldCenter.value);
      const cp = shipCenterPoint();
      targets.push({ kind: 'shield', i: 0, distance: Math.hypot(mx - sp.x, my - sp.y) });
      targets.push({ kind: 'center', i: 0, distance: Math.hypot(mx - cp.x, my - cp.y) });
    }
    return targets;
  }
  function selectForDown(e: MouseEvent, mx: number, my: number, pick: CanvasPick): CanvasTarget | null {
    if ((mode.value === 'weapon' || mode.value === 'engine') && (e.altKey || e.ctrlKey))
      return pick.byIdentity(inspectorLock.value ?? activeTarget.value) ?? pick.byPointer(mx, my);
    if (mode.value === 'ranges' && (e.shiftKey || e.ctrlKey)) return pick.byIdentity(activeTarget.value) ?? pick.byPointer(mx, my);
    const target = pick.byPointer(mx, my);
    if (mode.value === 'launchBay') selectedPort.value = target?.port ?? null;
    return target;
  }
  function resolveDragKind(e: MouseEvent, mx: number, my: number, target: CanvasTarget) {
    if (mode.value === 'weapon' && e.altKey) return 'weaponArc';
    if (mode.value === 'weapon' && e.ctrlKey) return 'weapon';
    if (mode.value === 'weapon') return 'weaponAngle';
    if (mode.value === 'engine' && e.altKey) return 'engineSize';
    if (mode.value === 'engine' && e.ctrlKey) return 'engine';
    if (mode.value === 'engine') return 'engineAngle';
    if (mode.value === 'ranges' && e.shiftKey) return 'collisionRadius';
    if (mode.value === 'ranges' && e.ctrlKey) return 'shieldRadius';
    if (mode.value === 'ranges') return targetKindAt(mx, my) || target.kind;
    return target.kind;
  }
  function nearestBoundsSegmentIndex(point: number[]) {
    return nearestBoundsSegment(bounds.value, point);
  }
  function offsetRelativeFields(dxAbsolute: number, dyAbsolute: number) {
    localShip.value.shieldCenter = shiftRelativePosition(localShip.value.shieldCenter, dxAbsolute, dyAbsolute);
    for (const slot of weaponSlots.value) slot.locations = shiftRelativePosition(slot.locations, dxAbsolute, dyAbsolute);
    for (const engine of engineSlots.value) engine.location = shiftRelativePosition(engine.location, dxAbsolute, dyAbsolute);
    for (let i = 0; i < bounds.value.length; i += 2) {
      bounds.value[i] = snapToStep((bounds.value[i] || 0) - dyAbsolute);
      bounds.value[i + 1] = snapToStep((bounds.value[i + 1] || 0) + dxAbsolute);
    }
  }
  function copyWeaponSlotAt(coord: number[]) {
    const source = selectedSlot.value ? deepClone(selectedSlot.value) : {};
    const relativeCoord = absoluteToRelative(coord);
    const sourceIndex = weaponSlots.value.length;
    const created = weaponSlotWithDefaults(source, nextWeaponSlotId(), relativeCoord);
    weaponSlots.value.push(created);
    if (mirrorMode.value && Math.abs(relativeCoord[1] || 0) > MIRROR_EPSILON) {
      weaponSlots.value.push({ ...mirrorWeaponSlotForAdd(created), id: nextWeaponSlotId() });
      mirrorPair.value = { kind: 'weapon', i: sourceIndex + 1 };
    } else {
      mirrorPair.value = null;
    }
    selected.value = sourceIndex;
    hovered.value = { kind: 'weapon', i: selected.value };
    activeTarget.value = { kind: 'weapon', i: selected.value };
  }
  function addLaunchBayAt(coord: number[]) {
    const relativeCoord = absoluteToRelative(coord);
    const sourceIndex = weaponSlots.value.length;
    const created = launchBayWithDefaults({}, nextLaunchBayId(), relativeCoord);
    weaponSlots.value.push(created);
    if (mirrorMode.value && Math.abs(relativeCoord[1] || 0) > MIRROR_EPSILON) {
      weaponSlots.value.push({ ...mirrorWeaponSlotForAdd(created), id: nextLaunchBayId() });
      mirrorPair.value = { kind: 'weapon', i: sourceIndex + 1 };
    } else {
      mirrorPair.value = null;
    }
    selected.value = sourceIndex;
    selectedPort.value = 0;
    hovered.value = { kind: 'launchBayPort', i: selected.value, port: 0 };
    activeTarget.value = { kind: 'launchBayPort', i: selected.value, port: 0 };
  }
  function addBayPortAt(relativeCoord: number[]) {
    const slot = selectedSlot.value;
    if (!slot) return;
    const portCount = bayPorts(slot.locations).length;
    slot.locations = appendBayPort(slot.locations, relativeCoord);
    if (mirrorMode.value && Math.abs(relativeCoord[1] || 0) > MIRROR_EPSILON) {
      slot.locations = appendBayPort(slot.locations, mirrorBayPort(relativeCoord));
    }
    selectedPort.value = portCount;
    const bayIndex = selected.value ?? weaponSlots.value.indexOf(slot);
    hovered.value = { kind: 'launchBayPort', i: bayIndex, port: portCount };
    activeTarget.value = { kind: 'launchBayPort', i: bayIndex, port: portCount };
  }
  function copyEngineAt(coord: number[]) {
    const source = selectedEngine.value ? deepClone(selectedEngine.value) : {};
    const relativeCoord = absoluteToRelative(coord);
    const sourceIndex = engineSlots.value.length;
    const created = engineWithDefaults(source, relativeCoord);
    engineSlots.value.push(created);
    if (mirrorMode.value && Math.abs(relativeCoord[1] || 0) > MIRROR_EPSILON) {
      engineSlots.value.push(mirrorEngineForAdd(created));
      mirrorPair.value = { kind: 'engine', i: sourceIndex + 1 };
    } else {
      mirrorPair.value = null;
    }
    selected.value = sourceIndex;
    hovered.value = { kind: 'engine', i: selected.value };
    activeTarget.value = { kind: 'engine', i: selected.value };
  }
  function updateInteraction(kind: string, mx: number, my: number) {
    const coord = canvasToShip(mx, my);
    const rawCoord = rawCanvasToShip(mx, my);
    const relativeCoord = canvasToRelative(mx, my);
    if (kind === 'weapon' && selectedSlot.value) selectedSlot.value.locations = relativeCoord;
    if (kind === 'launchBayPort' && selectedSlot.value && selectedPort.value !== null) {
      selectedSlot.value.locations = updateBayPort(selectedSlot.value.locations, selectedPort.value, relativeCoord);
    }
    if (kind === 'engine' && selectedEngine.value) selectedEngine.value.location = relativeCoord;
    if (kind === 'bound' && selected.value !== null) {
      bounds.value[selected.value * 2] = relativeCoord[0];
      bounds.value[selected.value * 2 + 1] = relativeCoord[1];
    }
    if (kind === 'shield') localShip.value.shieldCenter = relativeCoord;
    if (kind === 'center') {
      const previous = center.value;
      localShip.value.center = coord;
      offsetRelativeFields((coord[0] || 0) - (previous[0] || 0), (coord[1] || 0) - (previous[1] || 0));
    }
    if (kind === 'collisionRadius') localShip.value.collisionRadius = Math.max(0, Math.round(distance(rawCoord, center.value)));
    if (kind === 'shieldRadius')
      localShip.value.shieldRadius = Math.max(0, Math.round(distance(rawCoord, relativeToAbsolute(shieldCenter.value))));
    if (kind === 'weaponAngle' && selectedSlot.value) {
      selectedSlot.value.angle = pointAngle(relativeToAbsolute(slotLoc.value), rawCoord);
    }
    if (kind === 'weaponArc' && selectedSlot.value) {
      selectedSlot.value.arc = pointArc(relativeToAbsolute(slotLoc.value), rawCoord, num(selectedSlot.value.angle, 0));
    }
    if (kind === 'engineAngle' && selectedEngine.value) {
      selectedEngine.value.angle = pointAngle(relativeToAbsolute(engineLoc.value), rawCoord);
    }
    if (kind === 'engineSize') applyEngineSizeFromPointer(mx, my);
  }
  function captureMirrorPair() {
    mirrorPair.value = null;
    if (!mirrorMode.value || selected.value === null) return;
    if (mode.value === 'weapon' || mode.value === 'launchBay') {
      const index = findMirrorWeaponSlotIndex(weaponSlots.value, selected.value);
      if (index !== null) mirrorPair.value = { kind: 'weapon', i: index };
      return;
    }
    if (mode.value === 'engine') {
      const index = findMirrorEngineIndex(engineSlots.value, selected.value);
      if (index !== null) mirrorPair.value = { kind: 'engine', i: index };
      return;
    }
    if (mode.value === 'bounds') {
      const index = findMirrorBoundIndex(bounds.value, selected.value);
      if (index !== null) mirrorPair.value = { kind: 'bound', i: index };
    }
  }
  function applyMirrorInteraction(kind: string) {
    if (!mirrorMode.value || !mirrorPair.value) return;
    const pair = mirrorPair.value;
    if (kind === 'weapon' && pair.kind === 'weapon') {
      const pairSlot = weaponSlots.value[pair.i];
      if (pairSlot) pairSlot.locations = mirrorOffsetPoint(arr(selectedSlot.value?.locations, [0, 0]));
      return;
    }
    if (kind === 'weaponAngle' && pair.kind === 'weapon') {
      const pairSlot = weaponSlots.value[pair.i];
      if (pairSlot) pairSlot.angle = mirrorAngleDeg(num(selectedSlot.value?.angle, 0));
      return;
    }
    if (kind === 'weaponArc' && pair.kind === 'weapon') {
      const pairSlot = weaponSlots.value[pair.i];
      if (pairSlot) pairSlot.arc = num(selectedSlot.value?.arc, 0);
      return;
    }
    if (kind === 'engine' && pair.kind === 'engine') {
      const pairEngine = engineSlots.value[pair.i];
      if (pairEngine) pairEngine.location = mirrorOffsetPoint(arr(selectedEngine.value?.location, [0, 0]));
      return;
    }
    if (kind === 'engineAngle' && pair.kind === 'engine') {
      const pairEngine = engineSlots.value[pair.i];
      if (pairEngine) pairEngine.angle = mirrorAngleDeg(num(selectedEngine.value?.angle, 0));
      return;
    }
    if (kind === 'engineSize' && pair.kind === 'engine') {
      const pairEngine = engineSlots.value[pair.i];
      if (pairEngine) {
        pairEngine.length = num(selectedEngine.value?.length, 0);
        pairEngine.width = num(selectedEngine.value?.width, 0);
      }
      return;
    }
    if (kind === 'bound' && pair.kind === 'bound' && selected.value !== null) {
      bounds.value[pair.i * 2] = bounds.value[selected.value * 2] || 0;
      bounds.value[pair.i * 2 + 1] = mirrorLateral(bounds.value[selected.value * 2 + 1] || 0);
    }
  }
  function startBoundsInsert(coord: number[], insertAfter: number) {
    const at = Math.max(0, Math.min(bounds.value.length, (insertAfter + 1) * 2));
    bounds.value.splice(at, 0, coord[0] ?? 0, coord[1] ?? 0);
    if (mirrorMode.value && Math.abs(coord[1] || 0) > MIRROR_EPSILON) {
      bounds.value.splice(at + 2, 0, coord[0] ?? 0, mirrorLateral(coord[1] || 0));
      mirrorPair.value = { kind: 'bound', i: at / 2 + 1 };
    } else {
      mirrorPair.value = null;
    }
    selected.value = at / 2;
    hovered.value = { kind: 'bound', i: selected.value };
    activeTarget.value = { kind: 'bound', i: selected.value };
  }
  function applyEngineSizeFromPointer(mx: number, my: number) {
    if (!selectedEngine.value) return;
    const { length, width } = engineSizeFromPointer(mx, my);
    selectedEngine.value.width = width;
    selectedEngine.value.length = length;
  }
  function engineSizeFromPointer(mx: number, my: number) {
    return shipEngineSize(canvasToRelative(mx, my), selectedEngine.value!);
  }
  function actionDown(e: MouseEvent, mx: number, my: number) {
    const coord = canvasToShip(mx, my);
    const relativeCoord = canvasToRelative(mx, my);
    if (mode.value === 'bounds' && e.shiftKey) {
      beginEdit();
      bounds.value.push(relativeCoord[0], relativeCoord[1]);
      const sourceIndex = bounds.value.length / 2 - 1;
      if (mirrorMode.value && Math.abs(relativeCoord[1] || 0) > MIRROR_EPSILON) {
        bounds.value.push(relativeCoord[0], mirrorLateral(relativeCoord[1]));
        mirrorPair.value = { kind: 'bound', i: sourceIndex + 1 };
      } else {
        mirrorPair.value = null;
      }
      selected.value = sourceIndex;
      hovered.value = { kind: 'bound', i: selected.value };
      activeTarget.value = { kind: 'bound', i: selected.value };
      return 'bound';
    }
    if (mode.value === 'bounds' && e.ctrlKey) {
      beginEdit();
      startBoundsInsert(relativeCoord, nearestBoundsSegmentIndex(relativeCoord));
      return 'bound';
    }
    if (mode.value === 'launchBay' && e.ctrlKey) {
      beginEdit();
      addLaunchBayAt(coord);
      return 'launchBayPort';
    }
    if (mode.value === 'launchBay' && e.shiftKey) {
      if (selected.value === null || !selectedSlot.value || str(selectedSlot.value.type).toUpperCase() !== 'LAUNCH_BAY') {
        feedback.warning({
          userMessage: '先选中甲板，再为其新增港口',
          diagnostic: { code: 'ship.deck_required', message: 'A deck must be selected before adding a bay port', location: null },
        });
        return null;
      }
      beginEdit();
      addBayPortAt(relativeCoord);
      return 'launchBayPort';
    }
    if (mode.value === 'weapon' && e.shiftKey) {
      beginEdit();
      copyWeaponSlotAt(coord);
      return 'weapon';
    }
    if (mode.value === 'engine' && e.shiftKey) {
      beginEdit();
      copyEngineAt(coord);
      return 'engine';
    }
    return null;
  }
  function setField(key: string, value: RowData[string]) {
    localShip.value[key] = value;
    commitEdit();
  }
  function setVisualField(key: string, value: RowData[string]) {
    localShip.value[key] = value;
    draw();
    commitEdit();
  }
  function setSlotField(key: string, value: RowData[string]) {
    if (!selectedSlot.value) return;
    selectedSlot.value[key] = value;
    draw();
    commitEdit();
  }
  function setEngineField(key: string, value: RowData[string]) {
    if (!selectedEngine.value) return;
    selectedEngine.value[key] = value;
    draw();
    commitEdit();
  }
  function setArray(key: string, idx: number, value: number | null) {
    beginEdit();
    const v = arr(localShip.value[key], [0, 0]);
    v[idx] = value || 0;
    localShip.value[key] = v;
    draw();
    commitEdit();
  }
  function setSlotLoc(idx: number, value: number | null) {
    if (!selectedSlot.value) return;
    const loc = slotLoc.value;
    loc[idx] = value || 0;
    selectedSlot.value.locations = loc;
    draw();
    commitEdit();
  }
  function setBayPortCoord(portIndex: number, axis: 0 | 1, value: number | null) {
    if (!selectedSlot.value) return;
    const ports = bayPorts(selectedSlot.value.locations);
    const coord = ports[portIndex] ? [...ports[portIndex]] : [0, 0];
    coord[axis] = value || 0;
    selectedSlot.value.locations = updateBayPort(selectedSlot.value.locations, portIndex, coord);
    draw();
    commitEdit();
  }
  function removeBayPortAt(portIndex: number) {
    const slot = selectedSlot.value;
    if (!slot) return;
    beginEdit();
    const remaining = removeBayPort(slot.locations, portIndex);
    if (!remaining.length) {
      const bayIndex = selected.value;
      if (bayIndex !== null) weaponSlots.value.splice(bayIndex, 1);
      selected.value = null;
      hovered.value = null;
      activeTarget.value = null;
      inspectorLock.value = null;
      selectedPort.value = null;
    } else {
      slot.locations = remaining;
      selectedPort.value = Math.min(selectedPort.value ?? 0, bayPorts(remaining).length - 1);
    }
    commitEdit();
    draw();
  }
  function addBayPortFromPanel() {
    const slot = selectedSlot.value;
    if (!slot) return;
    beginEdit();
    const ports = bayPorts(slot.locations);
    const anchor = ports[ports.length - 1] ?? [0, 0];
    slot.locations = appendBayPort(slot.locations, [anchor[0] || 0, anchor[1] || 0]);
    selectedPort.value = ports.length;
    commitEdit();
    draw();
  }
  function setEngineLoc(idx: number, value: number | null) {
    if (!selectedEngine.value) return;
    const loc = engineLoc.value;
    loc[idx] = value || 0;
    selectedEngine.value.location = loc;
    draw();
    commitEdit();
  }
  function setBound(idx: number, value: number | null) {
    const b = bounds.value;
    b[idx] = value || 0;
    localShip.value.bounds = b;
    draw();
    commitEdit();
  }
  function selectInspectorItem(nextMode: typeof mode.value, index: number, kind: string) {
    mode.value = nextMode;
    selected.value = index;
    if (nextMode === 'launchBay') selectedPort.value = null;
    hovered.value = { kind, i: index };
    activeTarget.value = { kind, i: index };
    inspectorLock.value = { kind, i: index };
    draw();
  }
  function nextWeaponSlotId() {
    const used = new Set<string>();
    for (const slot of weaponSlots.value) {
      const id = str(slot.id);
      if (/^WS\d{4}$/.test(id)) used.add(id);
    }
    return nextFormattedId(used, formatWeaponSlotId);
  }
  function nextLaunchBayId() {
    const used = new Set<string>();
    for (const item of launchBaySlots.value) {
      const id = str(item.slot.id);
      if (/^LB \d+$/.test(id)) used.add(id);
    }
    return nextFormattedId(used, formatLaunchBayId);
  }
  function addWeaponSlot() {
    beginEdit();
    weaponSlots.value.push({
      id: nextWeaponSlotId(),
      size: 'MEDIUM',
      type: 'BALLISTIC',
      mount: 'TURRET',
      arc: 120,
      angle: 0,
      locations: [0, 0],
    });
    mode.value = 'weapon';
    selected.value = weaponSlots.value.length - 1;
    commitEdit();
    draw();
  }
  function addLaunchBay() {
    beginEdit();
    weaponSlots.value.push({
      id: nextLaunchBayId(),
      size: 'LARGE',
      type: 'LAUNCH_BAY',
      mount: 'HIDDEN',
      arc: 360,
      angle: 0,
      locations: [0, 0],
    });
    mode.value = 'launchBay';
    selected.value = weaponSlots.value.length - 1;
    commitEdit();
    draw();
  }
  function addEngine() {
    beginEdit();
    const sourceIndex = engineSlots.value.length;
    const created = { angle: 180, contrailSize: 12, length: 30, width: 10, location: [-50, 0], style: 'LOW_TECH' };
    engineSlots.value.push(created);
    const engineLocation = arr(created.location, [0, 0]);
    if (mirrorMode.value && Math.abs(engineLocation[1] || 0) > MIRROR_EPSILON) {
      engineSlots.value.push(mirrorEngineForAdd(created));
      mirrorPair.value = { kind: 'engine', i: sourceIndex + 1 };
    } else {
      mirrorPair.value = null;
    }
    mode.value = 'engine';
    selected.value = sourceIndex;
    commitEdit();
    draw();
  }
  function addBound() {
    beginEdit();
    bounds.value.push(0, 0);
    mode.value = 'bounds';
    selected.value = bounds.value.length / 2 - 1;
    commitEdit();
    draw();
  }
  function deleteSelected() {
    if (selected.value === null) return false;
    const selectedIndex = selected.value;
    let deleted = false;
    beginEdit();
    if (mode.value === 'weapon' || mode.value === 'launchBay') {
      const isLaunchBay = str(weaponSlots.value[selectedIndex]?.type).toUpperCase() === 'LAUNCH_BAY';
      if ((mode.value === 'weapon' && !isLaunchBay) || (mode.value === 'launchBay' && isLaunchBay)) {
        const pairIndex = mirrorMode.value ? findMirrorWeaponSlotIndex(weaponSlots.value, selectedIndex) : null;
        const indexes = pairIndex === null ? [selectedIndex] : [selectedIndex, pairIndex].sort((a, b) => b - a);
        for (const index of indexes) weaponSlots.value.splice(index, 1);
        deleted = true;
      }
    }
    if (mode.value === 'engine') {
      const pairIndex = mirrorMode.value ? findMirrorEngineIndex(engineSlots.value, selectedIndex) : null;
      const indexes = pairIndex === null ? [selectedIndex] : [selectedIndex, pairIndex].sort((a, b) => b - a);
      for (const index of indexes) engineSlots.value.splice(index, 1);
      deleted = true;
    }
    if (mode.value === 'bounds') {
      const pairIndex = mirrorMode.value ? findMirrorBoundIndex(bounds.value, selectedIndex) : null;
      const indexes = pairIndex === null ? [selectedIndex] : [selectedIndex, pairIndex].sort((a, b) => b - a);
      for (const index of indexes) bounds.value.splice(index * 2, 2);
      deleted = true;
    }
    if (!deleted) return false;
    selected.value = null;
    selectedPort.value = null;
    hovered.value = null;
    activeTarget.value = null;
    inspectorLock.value = null;
    commitEdit();
    draw();
    return true;
  }
  function builtInWeaponsUpdated(value: RowData) {
    localShip.value.builtInWeapons = value;
    commitEdit();
  }
  async function pickShipSprite() {
    const accepts = canvas.captureActionContext();
    const relative = await pickModImageReference({ sessionId: props.sessionId, modRoot: props.modRoot, title: '选择舰船贴图', accepts });
    if (!relative) return;
    localShip.value.spriteName = relative;
    commitEdit();
    loadSprite();
  }
  function save() {
    emit('save-requested');
  }
  watch(selected, (value) => {
    if (value === null) selectedPort.value = null;
  });
  const palette = useCanvasPalette(draw);
  const images = useEditorImages(
    () => ({ sprite: props.spriteData || '' }),
    () => {
      const image = images.images.get('sprite');
      spriteSize.value = image
        ? { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height }
        : { width: 0, height: 0 };
      if (image) scale.value = Math.min(1, 500 / Math.max(image.width, image.height));
      draw();
    },
  );
  watch(
    () => props.spriteData,
    () => {
      spriteSize.value = { width: 0, height: 0 };
    },
    { flush: 'sync' },
  );

  function selectBayPort(index: number) {
    selectedPort.value = index;
  }
  return {
    localShip,
    mode,
    selectedPort,
    expandedSections,
    spriteSize,
    selected,
    onDown,
    onExpandedSectionsUpdate,
    onLeave,
    onMove,
    onUp,
    onWheel,
    modes,
    footerNote,
    normalWeaponSlots,
    launchBaySlots,
    engineSlots,
    bounds,
    boundPairs,
    center,
    shieldCenter,
    moduleAnchor,
    selectedSlot,
    selectedEngine,
    slotLoc,
    selectedBayPorts,
    engineLoc,
    builtInMods,
    builtInWings,
    setMode,
    loadSprite,
    canSyncSpriteSize,
    syncSpriteSize,
    setField,
    setVisualField,
    setSlotField,
    setEngineField,
    setArray,
    setSlotLoc,
    setBayPortCoord,
    removeBayPortAt,
    addBayPortFromPanel,
    setEngineLoc,
    setBound,
    selectInspectorItem,
    addWeaponSlot,
    addLaunchBay,
    addEngine,
    addBound,
    deleteSelected,
    builtInWeaponsUpdated,
    pickShipSprite,
    save,
    runAction,
    beginField,
    fieldBlur,
    fieldKey,
    selectBayPort,
  };
}
