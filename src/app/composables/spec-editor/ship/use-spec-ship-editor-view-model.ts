import { computed, reactive, ref, watch, type EmitFn, type ShallowRef } from 'vue';
import type { RowData, EditContext } from '@/shared/types/index';
import type { CanvasInput, ShipEditorMode, ShipHoverPreview } from '@/domain/editors/editor-types';
import { num, str } from '@/shared/lib/starsector/index';
import { createSpecObject } from '@/domain/entity-write/spec-construction';
import { specFieldParent, updateSpecField } from '@/domain/spec-editor/spec-fields';
import { shipBuiltInWeaponsSchema, shipSpecIssues } from '@/domain/spec-editor/ship/spec-ship-fields';
import { useSpecProblems } from '../use-spec-problems';
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
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useSettingsStore } from '@/stores/settings.store';
import { renderSpecShipEditorScene } from '@/app/renderers/spec-editor/ship/spec-ship-scene';
import { useEngineRendering } from '../../editors/use-engine-rendering';
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
    expandedSections = ref<(string | number)[]>(['basic']),
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
  const feedback = useAppFeedback();
  const modes = [
    { shortcut: 'P', value: 'overview', label: '总览' },
    { shortcut: 'C', value: 'ranges', label: '范围' },
    { shortcut: 'B', value: 'bounds', label: '边界' },
    { shortcut: 'W', value: 'weapon', label: '武器' },
    { shortcut: 'L', value: 'launchBay', label: '战机甲板' },
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
    weapon: '左键 旋转角度 | Shift+左键 复制武器槽 | Ctrl+左键 移动位置 | Alt+左键 调整射界 | T 打开武器槽',
    launchBay: '左键 选中起降口 | 拖动 移动起降口 | Ctrl+左键 新建战机甲板 | Shift+左键 为选中战机甲板新增起降口 | T 打开战机甲板',
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
  const builtInWeaponsSchema = computed(() => shipBuiltInWeaponsSchema(localShip.value.weaponSlots as RowData[]));
  function validateSlotId(value: unknown) {
    const current = selectedSlot.value!.id;
    return value !== current && (localShip.value.weaponSlots as RowData[]).some((slot) => slot.id === value) ? '槽位 ID 已被使用' : null;
  }
  const palette = useCanvasPalette(draw);
  const engines = useEngineRendering(
    () => props.sessionId,
    draw,
    () => geometry.value.engines,
  );
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
  useSpecProblems(() => [
    ...shipSpecIssues(localShip.value),
    ...[...builtins.diagnostics.value, ...(engines.notices?.value ?? []), props.spriteError]
      .filter((message): message is string => Boolean(message))
      .map((message) => ({ severity: 'warning' as const, code: 'spec.preview', path: message, message })),
  ]);
  const relativeToCanvas = (relative: number[]) => toCanvas(shipRelativeToAbsolute(relative, geometry.value.center));
  const absolutePoint = (input: CanvasInput) => shipPointFromCanvas(input.point, viewport.center(), viewport.scale.value);
  function setMode(next: ShipEditorMode) {
    void document.run(() => {
      canvas.cancelInspectorReveal();
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
              userMessage: '先选中战机甲板，再为其新增起降口',
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
        const target = state.target.value,
          section = mode.value === 'ranges' ? (target?.kind === 'center' ? 'sprite' : 'props') : modeToSection[mode.value];
        if (!section || !target) return null;
        const selector =
          mode.value === 'ranges'
            ? `[data-field-path="${target.kind === 'center' ? 'center' : 'shieldCenter'}[0]"]`
            : target.kind === 'launchBayPort'
              ? `[data-inspector-target="launchBay-${target.i}-port-${target.port}"]`
              : `[data-inspector-target="${mode.value === 'bounds' ? 'bound' : mode.value}-${target.i}"]`;
        return { section, selector, lock: target };
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
    engines.paint((engineImages) =>
      renderSpecShipEditorScene(c.getContext('2d')!, {
        engineImages,
        engineKind: localShip.value.hullSize === 'FIGHTER' ? 'fighter' : 'ship',
        enginesBelow: builtins.hints.value.includes('RENDER_ENGINES_BELOW_HULL'),
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
      }),
    );
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
  function selectInspectorItem(next: ShipEditorMode, i: number, kind: string) {
    void canvas.revealInspector(() => {
      mode.value = next;
      state.select({ kind, i }, true);
      draw();
    });
  }
  function addElement(kind: 'weapon' | 'launchBay' | 'engine' | 'bound') {
    void document.command((ship) => {
      canvas.cancelInspectorReveal();
      const added = addShipElement(ship, kind, kind === 'engine' ? [-50, 0] : [0, 0], kind === 'engine' && state.mirrorMode.value);
      mode.value = kind === 'bound' ? 'bounds' : kind;
      state.select(added.target);
    });
  }
  function deleteSelected(owner = mode.value) {
    const target = state.target.value;
    if (!target || owner !== mode.value || !['weapon', 'launchBay', 'engine', 'bounds'].includes(mode.value)) return;
    void document.command((ship) => {
      deleteShipElement(ship, target, state.mirrorMode.value);
      state.reset();
    });
  }
  function setProperty(path: string, value: RowData[string]) {
    if (path === 'spriteName') {
      setField(path, value);
      return;
    }
    document.change((ship) => {
      if (path.startsWith('center[')) centerRevision++;
      const { parent, key } = specFieldParent(ship, path);
      if (key === 'id' && (ship.weaponSlots as RowData[]).includes(parent) && parent.id !== value) {
        const weapons = ship.builtInWeapons as RowData;
        if (Object.hasOwn(weapons, String(parent.id))) {
          ship.builtInWeapons = { ...weapons, [String(value)]: weapons[String(parent.id)]! };
          delete (ship.builtInWeapons as RowData)[String(parent.id)];
        }
      }
      updateSpecField(ship, path, value);
    });
  }
  function setCoversColor(value: RowData[string]) {
    setField('coversColor', Array.isArray(value) ? value.join(',') : '');
  }
  function addBayPortFromPanel() {
    const index = state.selected.value;
    if (
      mode.value !== 'launchBay' ||
      index === null ||
      str((localShip.value.weaponSlots as RowData[])[index]?.type).toUpperCase() !== 'LAUNCH_BAY'
    )
      return;
    return document.command((ship) => {
      const slot = (ship.weaponSlots as RowData[])[index]!,
        ports = bayPorts(slot.locations);
      slot.locations = appendBayPort(slot.locations, ports.at(-1) ?? [0, 0]);
      state.selectPort(ports.length);
    });
  }
  return {
    document: localShip,
    view: reactive({
      mode,
      mirror: state.mirrorMode,
      fitted: viewport.fitted,
      engineStyles: engines.styleNames,
      coversColor: computed(() =>
        str(localShip.value.coversColor) ? str(localShip.value.coversColor).split(',').map(Number) : [255, 255, 255, 255],
      ),
      selected: state.selected,
      selectedPort: state.selectedPort,
      expandedSections,
      spriteSize,
      modes,
      footerNote,
      normalWeaponSlots,
      builtInWeaponsSchema,
      validateSlotId,
      launchBaySlots,
      engineSlots: computed(() => localShip.value.engineSlots as RowData[]),
      bounds: computed(() => geometry.value.bounds),
      boundPairs: computed(() => Array.from({ length: Math.floor(geometry.value.bounds.length / 2) })),
      selectedSlot,
      selectedEngine,
      selectedBayPorts: computed(() => bayPorts(selectedSlot.value?.locations)),
      canSyncSpriteSize: computed(
        () => spriteSize.value.width > 0 && spriteSize.value.height > 0 && props.spriteSourcePath === str(localShip.value.spriteName),
      ),
    }),
    actions: {
      removeField: (path: string) => document.change((ship) => updateSpecField(ship, path, undefined)),
      setProperty,
      setCoversColor,
      removeProperty: (path: string) => document.command((ship) => updateSpecField(ship, path, undefined)),
      createInlineStyle: () => {
        const engine = selectedEngine.value!;
        return document.command(() => {
          engine.style = 'CUSTOM';
          delete engine.styleId;
          engine.styleSpec ??= createSpecObject('styleSpec');
        });
      },
      toggleMirror: () =>
        document.run(() => {
          state.toggleMirror();
          draw();
        }),
      fitView: () => {
        viewport.fit(Math.min(1, 500 / Math.max(spriteSize.value.width || 1, spriteSize.value.height || 1)));
        draw();
      },
      setMode,
      selectInspectorItem,
      deleteSelected,
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
      addBayPortFromPanel,
      selectBayPort: (port: number) =>
        canvas.revealInspector(() => {
          state.select({ kind: 'launchBayPort', i: state.selected.value!, port }, true);
          draw();
        }),
      addWeaponSlot: () => addElement('weapon'),
      addLaunchBay: () => addElement('launchBay'),
      addEngine: () => addElement('engine'),
      addBound: () => addElement('bound'),
      builtInWeaponsUpdated: (value: RowData) => {
        for (const field of builtInWeaponsSchema.value.nested!)
          if (value[field.key] === '' && value[field.key] !== (localShip.value.builtInWeapons as RowData)[field.key])
            delete value[field.key];
        setField('builtInWeapons', value);
      },
      loadSprite,
      syncShipCenter: () =>
        document.command((ship) => {
          centerRevision++;
          ship.center = [spriteSize.value.width / 2, spriteSize.value.height / 2];
        }),
      syncSpriteSize: () => document.command((ship) => Object.assign(ship, spriteSize.value)),
    },
    canvas: { ...canvas, beginField: document.beginField, fieldBlur: document.fieldBlur, fieldKey: document.fieldKey },
  };
}
