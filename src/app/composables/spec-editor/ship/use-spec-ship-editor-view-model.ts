import { computed, reactive, ref, watch, type EmitFn, type ShallowRef } from 'vue';
import type { RowData, EditContext } from '@/shared/types/index';
import type { CanvasInput, ShipEditorMode, ShipHoverPreview } from '@/domain/editors/editor-types';
import { arr, num, str } from '@/shared/lib/starsector/index';
import {
  normalizeShipSpec,
  bayPorts,
  appendBayPort,
  updateBayPort,
  projectShipGeometry,
  shipOperationKind,
  shipPreviewTakesOver,
  previewShipOperation,
  beginShipOperation,
  updateShipOperation,
  addShipElement,
  deleteShipElement,
  removeShipPort,
  shipTargets,
} from '@/domain/spec-editor/ship/spec-ship-editing';

import { shipCanvasPoint, shipPointFromCanvas, shipRelativeToAbsolute, distance } from '@/domain/editors/lib/geometry';

import { useEditorDocument } from '../../editors/use-editor-document';
import { createCanvasState } from '@/app/composables/canvas/use-canvas-state';
import { useCanvasEditor, type CanvasPick } from '@/app/composables/canvas/use-canvas-editor';
import { useCanvasViewport } from '@/app/composables/canvas/use-canvas-viewport';
import { useCanvasPalette } from '@/app/composables/canvas/use-canvas-palette';
import { useEditorImages } from '../../editors/use-editor-images';
import { useSpecShipWeapons } from './use-spec-ship-weapons';
import { useResourceReference } from '../../editors/use-resource-reference';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useSettingsStore } from '@/stores/settings.store';
import { renderSpecShipEditorScene } from '@/app/renderers/spec-editor/ship/spec-ship-scene';
export interface SpecShipEditorProps {
  modRoot: string;
  sessionId: string;
  hullId: string;
  ship: RowData;
  spriteData?: string;
  spriteSourcePath?: string;
  spriteError?: string;
  editContext: EditContext | null;
  path?: string;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  externalUpdateNotice: string;
}
export type SpecShipEditorEvents = {
  close: [];
  'reset-requested': [];
  'save-requested': [];
  'draft-changed': [ship: RowData];
  'load-external': [];
};
export function useSpecShipEditorViewModel(
  props: Readonly<SpecShipEditorProps>,
  emit: EmitFn<SpecShipEditorEvents>,
  elements: {
    editorWindowRef: Readonly<ShallowRef<HTMLElement | null>>;
    stageRef: Readonly<ShallowRef<HTMLElement | null>>;
    canvasRef: Readonly<ShallowRef<HTMLCanvasElement | null>>;
  },
) {
  const { editorWindowRef, stageRef, canvasRef } = elements;
  const settings = useSettingsStore();
  const state = createCanvasState<ShipHoverPreview>();
  const mode = ref<ShipEditorMode>('overview'),
    expandedSections = ref(['basic']),
    spriteSize = ref({ width: 0, height: 0 });
  const viewport = useCanvasViewport(canvasRef, 1, 10);
  let fitPending = true,
    centerRevision = 0,
    spriteAbsent = !str(props.ship.spriteName);
  let spriteAction: { path: string; center: boolean; revision: number } | null = null;
  const document = useEditorDocument({
    source: () => props.ship,
    normalize: normalizeShipSpec,
    context: computed(() => props.editContext),
    publish: (value) => emit('draft-changed', value),
    historyLimit: computed(() => settings.editHistoryLimit),
    contains: (element) => Boolean(editorWindowRef.value?.contains(element)),
    draw,
    reset: (reason) => {
      spriteAction = null;
      if (reason === 'replay') fitPending = true;
      state.reset();
      canvas?.reset();
    },
  });
  const localShip = document.value,
    geometry = computed(() => projectShipGeometry(localShip.value));
  const feedback = useAppFeedback(),
    { pickModImageReference } = useResourceReference();
  const modes = [
    { shortcut: 'P', value: 'overview', label: '总览' },
    { shortcut: 'C', value: 'ranges', label: '范围' },
    { shortcut: 'B', value: 'bounds', label: '边界' },
    { shortcut: 'W', value: 'weapon', label: '武器' },
    { shortcut: 'L', value: 'launchBay', label: '甲板' },
    { shortcut: 'E', value: 'engine', label: '引擎' },
  ] as const;
  const modeToSection: Record<ShipEditorMode, string | null> = {
    overview: null,
    ranges: 'props',
    bounds: 'bounds',
    weapon: 'weapons',
    launchBay: 'launchBays',
    engine: 'engines',
  };
  const modeFooterNotes: Record<ShipEditorMode, string> = {
    overview: '仅查看',
    ranges: '左键 拖动中心或护盾 | Shift+左键 改碰撞半径 | Ctrl+左键 改护盾半径 | T 打开中心与护盾',
    bounds: '左键 拖动边界点 | Shift+左键 追加边界点 | Ctrl+左键 插入最近边段 | T 打开碰撞边界',
    weapon: '左键 旋转角度 | Shift+左键 复制武器槽 | Ctrl+左键 移动位置 | Alt+左键 调整射角 | T 打开武器槽',
    launchBay: '左键 选中港口 | 拖动 移动港口 | Ctrl+左键 新建甲板 | Shift+左键 为选中甲板新增港口 | T 打开甲板',
    engine: '左键 旋转角度 | Shift+左键 复制引擎 | Ctrl+左键 移动位置 | Alt+左键 调整宽高 | T 打开引擎',
  };
  const footerNote = computed(
    () =>
      '右键 拖动画布 | 滚轮 缩放 | Ctrl+Z 撤销 | Ctrl+Shift+Z 重做' +
      (state.mirrorMode.value ? '（镜像模式）' : '') +
      '\n' +
      modeFooterNotes[mode.value] +
      ' | 空格 ' +
      (state.mirrorMode.value ? '关闭' : '开启') +
      '镜像',
  );
  const selectedSlot = computed(() =>
    state.selected.value === null ? null : (localShip.value.weaponSlots as RowData[])[state.selected.value],
  );
  const selectedEngine = computed(() =>
    state.selected.value === null ? null : (localShip.value.engineSlots as RowData[])[state.selected.value],
  );
  const slotLoc = computed(() => arr(selectedSlot.value?.locations, [0, 0])),
    engineLoc = computed(() => arr(selectedEngine.value?.location, [0, 0]));
  const normalWeaponSlots = computed(() =>
    (localShip.value.weaponSlots as RowData[])
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => str(slot.type).toUpperCase() !== 'LAUNCH_BAY'),
  );
  const launchBaySlots = computed(() =>
    (localShip.value.weaponSlots as RowData[])
      .map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => str(slot.type).toUpperCase() === 'LAUNCH_BAY'),
  );
  const palette = useCanvasPalette(draw);
  const images = useEditorImages(
    () => ({ sprite: props.spriteData || '' }),
    () => {
      const image = images.images.get('sprite');
      spriteSize.value = image ? { width: image.width, height: image.height } : { width: 0, height: 0 };
      const action = image && spriteAction?.path === props.spriteSourcePath ? spriteAction : null;
      if (action) {
        const size = { ...spriteSize.value },
          accepts = document.captureActionContext();
        spriteAction = null;
        void document.command((ship) => {
          if (!accepts() || str(ship.spriteName) !== action.path) return;
          Object.assign(ship, size);
          if (action.center && action.revision === centerRevision) ship.center = [size.width / 2, size.height / 2];
        });
      }
      if (image) spriteAbsent = false;
      if (image && fitPending) {
        viewport.scale.value = Math.min(1, 500 / Math.max(image.width, image.height));
        fitPending = false;
      }
      draw();
    },
    () => {
      spriteAbsent = true;
    },
  );
  watch(
    () => props.spriteError,
    (error) => {
      if (error) spriteAbsent = true;
    },
  );
  function loadSprite() {
    spriteAction ??= { path: str(localShip.value.spriteName), center: spriteAbsent, revision: centerRevision };
    images.reload();
  }
  const builtins = useSpecShipWeapons(
    () => ({ sessionId: props.sessionId, modRoot: props.modRoot, kind: 'ship', id: props.hullId }),
    () => localShip.value,
    draw,
  );
  const toCanvas = (absolute: number[]) => shipCanvasPoint(absolute, viewport.center(), viewport.scale.value);
  const relativeToCanvas = (relative: number[]) => toCanvas(shipRelativeToAbsolute(relative, geometry.value.center));
  const absolutePoint = (input: CanvasInput) => shipPointFromCanvas(input.point, viewport.center(), viewport.scale.value);
  function setMode(next: ShipEditorMode) {
    void document.run(() => {
      mode.value = next;
      state.reset();
      draw();
    });
  }
  function selectedTarget(input: CanvasInput, pick: CanvasPick) {
    const { x, y } = input.point;
    const locked = (mode.value === 'weapon' || mode.value === 'engine') && (input.altKey || input.ctrlKey);
    const range = mode.value === 'ranges' && (input.shiftKey || input.ctrlKey);
    let target = locked
      ? (pick.byIdentity(state.inspectorLock.value ?? state.hovered.value) ?? pick.byPointer(x, y))
      : range
        ? (pick.byIdentity(state.hovered.value) ?? pick.byPointer(x, y))
        : pick.byPointer(x, y);
    if (mode.value === 'ranges' && !input.shiftKey && !input.ctrlKey) {
      const absolute = absolutePoint(input),
        g = geometry.value;
      const shield = distance(absolute, shipRelativeToAbsolute(g.shieldCenter, g.center)),
        center = distance(absolute, g.center);
      target = {
        kind: (distance([0, 0], g.shieldCenter) === 0 && shield === center) || shield < center ? 'shield' : 'center',
        i: 0,
        distance: Math.min(shield, center),
      };
    }
    return target;
  }
  const canvas = useCanvasEditor({
    document,
    stageRef,
    windowRef: editorWindowRef,
    expandedSections,
    viewport,
    state,
    hooks: {
      targets: (x, y) =>
        shipTargets(geometry.value, mode.value, relativeToCanvas).map((target) => ({
          ...target,
          distance: Math.hypot(x - target.point.x, y - target.point.y),
        })),
      radius: (target) =>
        target.kind === 'launchBayPort'
          ? 16
          : target.kind === 'engine'
            ? 28
            : target.kind === 'center' || target.kind === 'shield'
              ? 30
              : 26,
      begin: (input, pick) => {
        const candidate = state.target.value,
          kind = shipOperationKind(mode.value, input, candidate);
        const adds = kind && ['boundAppend', 'boundInsert', 'weaponCopy', 'engineCopy', 'launchBayAdd', 'launchBayPortAdd'].includes(kind);
        const target = adds ? candidate : selectedTarget(input, pick),
          operation = shipOperationKind(mode.value, input, target);
        if (!operation) return null;
        const gesture = beginShipOperation(localShip.value, operation, target, absolutePoint(input), state.mirrorMode.value);
        if (!gesture) {
          if (operation === 'launchBayPortAdd')
            feedback.warning({
              userMessage: '先选中甲板，再为其新增港口',
              diagnostic: { code: 'ship.deck_required', message: 'A deck must be selected before adding a bay port', location: null },
            });
          return null;
        }
        if (adds) state.select(gesture.target);
        return {
          kind: gesture.kind,
          update: (input) => {
            if (gesture.kind === 'center') centerRevision++;
            updateShipOperation(localShip.value, gesture, absolutePoint(input));
          },
        };
      },
      preview: (input) =>
        previewShipOperation(localShip.value, mode.value, state.target.value, input, absolutePoint(input), state.mirrorMode.value),
      previewTakesOver: (input) => shipPreviewTakesOver(mode.value, input),
      deleteSelected: () => deleteSelected(),
      shortcuts: Object.fromEntries(modes.map((item) => [item.shortcut.toLowerCase(), () => setMode(item.value)])),
      inspector: () => {
        const section = modeToSection[mode.value],
          target = state.hovered.value;
        if (!section) return null;
        const selector =
          mode.value === 'ranges'
            ? target
              ? '[data-inspector-field="' + (target.kind === 'center' ? 'center-x' : 'shield-x') + '"]'
              : ''
            : state.selected.value !== null
              ? '[data-inspector-target="' +
                (mode.value === 'launchBay' ? 'launchBay' : mode.value === 'bounds' ? 'bound' : mode.value) +
                '-' +
                state.selected.value +
                '"]'
              : '';
        return selector ? { section, selector, lock: target } : null;
      },
      draw,
    },
  });
  function cursorLabel(coord: number[]) {
    const preview = state.preview.value,
      kind = canvas.dragKind.value;
    if (kind === 'weaponAngle') return Math.round(num(selectedSlot.value?.angle)) + '°';
    if (kind === 'weaponArc' || preview?.kind === 'weaponArc')
      return Math.round(preview?.kind === 'weaponArc' ? preview.arc : num(selectedSlot.value?.arc)) + '°';
    if (kind === 'engineAngle') return Math.round(num(selectedEngine.value?.angle)) + '°';
    if (kind === 'engineSize' || preview?.kind === 'engineSize')
      return (
        Math.round(preview?.kind === 'engineSize' ? preview.length : num(selectedEngine.value?.length)) +
        ' x ' +
        Math.round(preview?.kind === 'engineSize' ? preview.width : num(selectedEngine.value?.width))
      );
    return coord.map((v) => v.toFixed(1)).join(', ');
  }
  function draw() {
    const c = canvasRef.value;
    if (!c) return;
    const pointer = canvas.pointerState(),
      point = absolutePoint({ point: pointer, shiftKey: false, ctrlKey: false, altKey: false }).map((v) => Math.round(v * 2) / 2);
    const g = geometry.value,
      sprite = images.images.get('sprite') ?? null;
    const coord =
      mode.value === 'overview' || mode.value === 'ranges'
        ? point
        : [(point[1] || 0) - (g.center[1] || 0), (g.center[0] || 0) - (point[0] || 0)].map((v) => Math.round(v * 2) / 2);
    renderSpecShipEditorScene(c.getContext('2d')!, {
      base: {
        ...viewport.size(),
        center: viewport.center(),
        scale: viewport.scale.value,
        palette: palette.value,
        mirrorY: state.mirrorMode.value && ['weapon', 'launchBay', 'engine', 'bounds'].includes(mode.value) ? toCanvas(g.center).y : null,
        cursor: pointer.inside ? { point: toCanvas(point), label: cursorLabel(coord) } : null,
      },
      geometry: g,
      interaction: {
        mode: mode.value,
        target: state.target.value,
        hovered: state.hovered.value,
        dragKind: canvas.dragKind.value,
        preview: state.preview.value,
        mirror: state.mirrorMode.value,
      },
      resources: { sprite, tintedSprite: sprite ? images.tintImage(sprite, [127, 127, 127]) : null },
      weapons: { items: builtins.weapons.value, image: builtins.image },
    });
  }
  function setField(key: string, value: RowData[string]) {
    if (key === 'spriteName') {
      spriteAction = { path: str(value), center: spriteAbsent, revision: centerRevision };
      spriteAbsent ||= !str(value);
      fitPending = true;
    }
    document.change((ship) => {
      ship[key] = value;
    });
  }
  function setArray(key: string, index: number, value: number | null) {
    document.change((ship) => {
      if (key === 'center') centerRevision++;
      const values = arr(ship[key], [0, 0]);
      values[index] = value || 0;
      ship[key] = values;
    });
  }
  function setItemField(kind: 'weapon' | 'engine', key: string, value: RowData[string]) {
    if (state.selected.value === null) return;
    document.change((ship) => {
      ((kind === 'weapon' ? ship.weaponSlots : ship.engineSlots) as RowData[])[state.selected.value!]![key] = value;
    });
  }
  function setLocation(kind: 'weapon' | 'engine', index: number, value: number | null) {
    if (state.selected.value === null) return;
    document.change((ship) => {
      const item = (kind === 'weapon' ? ship.weaponSlots : ship.engineSlots) as RowData[],
        key = kind === 'weapon' ? 'locations' : 'location';
      const loc = arr(item[state.selected.value!]![key], [0, 0]);
      loc[index] = value || 0;
      item[state.selected.value!]![key] = loc;
    });
  }
  function selectInspectorItem(next: ShipEditorMode, i: number, kind: string) {
    void document.run(() => {
      mode.value = next;
      state.select({ kind, i }, true);
      draw();
    });
  }
  function addElement(kind: 'weapon' | 'launchBay' | 'engine' | 'bound') {
    void document.command((ship) => {
      const added = addShipElement(ship, kind, kind === 'engine' ? [-50, 0] : [0, 0], kind === 'engine' && state.mirrorMode.value);
      mode.value = kind === 'bound' ? 'bounds' : kind;
      state.select(added.target);
    });
  }
  function deleteSelected() {
    const target = state.target.value;
    if (!target || !['weapon', 'launchBay', 'engine', 'bounds'].includes(mode.value)) return;
    void document.command((ship) => {
      deleteShipElement(ship, target, state.mirrorMode.value);
      state.reset();
    });
  }
  async function pickShipSprite() {
    const relative = await pickModImageReference({
      sessionId: props.sessionId,
      modRoot: props.modRoot,
      title: '选择舰船贴图',
      accepts: document.captureActionContext(),
    });
    if (relative) setField('spriteName', relative);
  }
  return {
    document: localShip,
    view: reactive({
      mode,
      selected: state.selected,
      selectedPort: state.selectedPort,
      expandedSections,
      spriteSize,
      modes,
      footerNote,
      weaponDiagnostics: builtins.diagnostics,
      normalWeaponSlots,
      launchBaySlots,
      engineSlots: computed(() => localShip.value.engineSlots as RowData[]),
      bounds: computed(() => geometry.value.bounds),
      boundPairs: computed(() => Array.from({ length: Math.floor(geometry.value.bounds.length / 2) })),
      center: computed(() => geometry.value.center),
      shieldCenter: computed(() => geometry.value.shieldCenter),
      moduleAnchor: computed(() => arr(localShip.value.moduleAnchor, [0, 0])),
      selectedSlot,
      selectedEngine,
      slotLoc,
      engineLoc,
      selectedBayPorts: computed(() => bayPorts(selectedSlot.value?.locations)),
      builtInMods: document.field(
        'builtInMods',
        (value) => value as string[],
        (value) => value,
      ),
      builtInWings: document.field(
        'builtInWings',
        (value) => value as string[],
        (value) => value,
      ),
      canSyncSpriteSize: computed(() => spriteSize.value.width > 0 && spriteSize.value.height > 0),
    }),
    actions: {
      setMode,
      setField,
      setVisualField: setField,
      setArray,
      selectInspectorItem,
      deleteSelected,
      setSlotField: (key: string, value: RowData[string]) => setItemField('weapon', key, value),
      setEngineField: (key: string, value: RowData[string]) => setItemField('engine', key, value),
      setSlotLoc: (i: number, value: number | null) => setLocation('weapon', i, value),
      setEngineLoc: (i: number, value: number | null) => setLocation('engine', i, value),
      setBound: (i: number, value: number | null) =>
        document.change((ship) => {
          (ship.bounds as number[])[i] = value || 0;
        }),
      setBayPortCoord: (port: number, axis: 0 | 1, value: number | null) =>
        document.change((ship) => {
          const slot = (ship.weaponSlots as RowData[])[state.selected.value!]!,
            loc = bayPorts(slot.locations)[port]!;
          loc[axis] = value || 0;
          slot.locations = updateBayPort(slot.locations, port, loc);
        }),
      removeBayPortAt: (port: number) =>
        document.command((ship) => {
          const i = state.selected.value!,
            next = removeShipPort(ship, i, port);
          if (next === null) state.reset();
          else
            state.selectPort(Math.min(state.selectedPort.value ?? 0, bayPorts((ship.weaponSlots as RowData[])[i]!.locations).length - 1));
        }),
      addBayPortFromPanel: () =>
        document.command((ship) => {
          const slot = (ship.weaponSlots as RowData[])[state.selected.value!]!,
            ports = bayPorts(slot.locations);
          slot.locations = appendBayPort(slot.locations, ports.at(-1) ?? [0, 0]);
          state.selectPort(ports.length);
        }),
      selectBayPort: (port: number) =>
        document.run(() => {
          state.selectPort(port);
          draw();
        }),
      addWeaponSlot: () => addElement('weapon'),
      addLaunchBay: () => addElement('launchBay'),
      addEngine: () => addElement('engine'),
      addBound: () => addElement('bound'),
      builtInWeaponsUpdated: (value: RowData) => setField('builtInWeapons', value),
      pickShipSprite: () => document.run(() => void pickShipSprite()),
      loadSprite,
      syncShipCenter: () =>
        document.command((ship) => {
          centerRevision++;
          ship.center = [spriteSize.value.width / 2, spriteSize.value.height / 2];
        }),
      syncSpriteSize: () => document.command((ship) => Object.assign(ship, spriteSize.value)),
      save: () => emit('save-requested'),
    },
    canvas: { ...canvas, beginField: document.beginField, fieldBlur: document.fieldBlur, fieldKey: document.fieldKey },
  };
}
