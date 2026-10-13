import { computed, ref, watch, type EmitFn, type ShallowRef } from 'vue';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import type { RowData, EditContext, WeaponSpecClass } from '@/shared/types';
import { arr, str } from '@/shared/lib/starsector';
import { changeWeaponSpecClass } from '@/domain/editors/spec-construction';
import { normalizeWeaponSpec } from '@/domain/editors/lib/normalize';
import { pointAngleScreen } from '@/domain/editors/lib/geometry';
import {
  useCanvasEditor,
  createCanvasEditorState,
  type CanvasInspectorReveal,
  type CanvasModifiers,
  type CanvasPick,
  type CanvasTarget,
} from '@/app/composables/canvas/use-canvas-editor';
import { useCanvasViewport } from '@/app/composables/canvas/use-canvas-viewport';
import { useObjectField } from '@/app/composables/editors/use-object-field';
import { useResourceReference } from '@/app/composables/editors/use-resource-reference';
import { snapToStep } from '@/domain/editors/lib/editor-constants';
import { findMirrorBarrelIndex, mirrorLateral, mirrorAngleDeg, MIRROR_EPSILON } from '@/domain/editors/lib/mirror';
import {
  HARDPOINT_WEAPON_SPRITE_FIELDS,
  TURRET_WEAPON_SPRITE_FIELDS,
  weaponAnglesKey,
  weaponOffsetsKey,
  type WeaponSpriteField,
  type WeaponViewMode,
} from '@/domain/editors/lib/weapon-sprite-fields';
import { renderWeaponScene } from '@/app/renderers/editors/weapon-scene';
import type { BarrelPreview } from '@/domain/editors/editor-types';
import { useCanvasPalette } from '@/app/composables/canvas/use-canvas-palette';
import { useEditorImages } from '@/app/composables/editors/use-editor-images';
import { useEditorFrameLoop } from '@/app/composables/editors/use-editor-frame-loop';

export interface WeaponEditorProps {
  modRoot: string;
  sessionId: string;
  weaponId: string;
  weapon: RowData;
  spriteData?: Record<string, string>;
  projectileOptions: { label: string; value: string }[];
  editContext: EditContext | null;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  externalUpdateNotice: string;
}
export type WeaponEditorEvents = {
  close: [];
  'save-requested': [];
  'draft-changed': [weapon: RowData];
  'load-external': [];
  'edit-projectile': [id: string];
  preview: [id: string];
};

export function useWeaponEditorViewModel(
  props: Readonly<WeaponEditorProps>,
  emit: EmitFn<WeaponEditorEvents>,
  elements: {
    editorWindowRef: Readonly<ShallowRef<HTMLElement | null>>;
    stageRef: Readonly<ShallowRef<HTMLElement | null>>;
    canvasRef: Readonly<ShallowRef<HTMLCanvasElement | null>>;
  },
) {
  const { editorWindowRef, stageRef, canvasRef } = elements;

  const localWeapon = ref<RowData>(normalizeWeaponSpec(props.weapon));
  const { commitBefore } = useFieldInputActions();
  const viewMode = ref<WeaponViewMode>('turret');
  const expandedSections = ref<string[]>(['basic']);
  const viewport = useCanvasViewport(canvasRef, 2, 20);
  const { scale } = viewport;
  const editorState = createCanvasEditorState<BarrelPreview>();
  const { activeTarget, hoverPreview, hovered, inspectorLock, mirrorMode, mirrorPair, selected, setPreview } = editorState;
  const canvas = useCanvasEditor({
    context: computed(() => props.editContext),
    stageRef,
    windowRef: editorWindowRef,
    expandedSections,
    viewport,
    state: editorState,
    hooks: {
      value: localWeapon,
      sourceValue: () => props.weapon,
      onDraftMutated: (value) => emit('draft-changed', value),
      normalize: normalizeWeaponSpec,
      deleteSelected: deleteSelectedBarrel,
      shortcutKeys: {
        u: () => setView('turret'),
        h: () => setView('hardpoint'),
      },
      inspectorReveal: (): CanvasInspectorReveal | null => ({
        section: currentBarrelSection(),
        selector: selected.value === null ? '' : `[data-inspector-target="${viewMode.value}-barrel-${selected.value}"]`,
        lock: activeTarget.value ? { ...activeTarget.value } : null,
      }),
      selectableTargets,
      hitRadius: () => 26,
      actionDown,
      selectForDown,
      resolveDragKind,
      applyDrag: updateInteraction,
      applyMirrorDrag: applyMirrorDrag,
      captureMirrorPair,
      previewTakesOver: (e) => e.shiftKey || e.ctrlKey,
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
  const { bindObjectField } = useObjectField(localWeapon, { onCommit: () => commitEdit() });
  const { pickModImageReference } = useResourceReference();
  const turretSpriteFields = TURRET_WEAPON_SPRITE_FIELDS;
  const hardpointSpriteFields = HARDPOINT_WEAPON_SPRITE_FIELDS;
  const modeFooterNotes: Record<WeaponViewMode, string> = {
    turret: '左键 拖动发射点 | Shift+左键 添加发射点 | Ctrl+左键 设置角度 | 退格 删除发射点 | T 打开炮塔发射点',
    hardpoint: '左键 拖动发射点 | Shift+左键 添加发射点 | Ctrl+左键 设置角度 | 退格 删除发射点 | T 打开固定发射点',
  };
  const footerNote = computed(
    () =>
      `右键 拖动画布 | 滚轮缩放 | Ctrl+Z 撤销 | Ctrl+Shift+Z 重做${mirrorMode.value ? '（镜像模式）' : ''}\n${
        modeFooterNotes[viewMode.value]
      }${mirrorMode.value ? ' | 空格 关闭镜像' : ' | 空格 开启镜像'}`,
  );

  const showProjectileSections = computed(() => localWeapon.value.specClass === 'projectile');
  const showBeamSection = computed(() => localWeapon.value.specClass === 'beam');
  const offsets = computed<number[]>(() => offsetsFor(viewMode.value));
  const angles = computed<number[]>(() => anglesFor(viewMode.value));
  const barrelCount = computed(() => barrelCountFor(viewMode.value));
  const projectileSpecId = computed({
    get: () => str(localWeapon.value.projectileSpecId),
    set: (v) => {
      localWeapon.value.projectileSpecId = v;
      commitEdit();
    },
  });
  const projectileOptions = computed(() => props.projectileOptions);
  const fringeColor = computed({
    get: () => arr(localWeapon.value.fringeColor, [255, 255, 255, 255]),
    set: (v) => {
      localWeapon.value.fringeColor = v;
      commitEdit();
    },
  });
  const coreColor = computed({
    get: () => arr(localWeapon.value.coreColor, [255, 255, 255, 255]),
    set: (v) => {
      localWeapon.value.coreColor = v;
      commitEdit();
    },
  });
  const glowColor = computed({
    get: () => arr(localWeapon.value.glowColor, [255, 255, 255, 255]),
    set: (v) => {
      localWeapon.value.glowColor = v;
      commitEdit();
      draw();
    },
  });
  const muzzleFlashSpec = bindObjectField('muzzleFlashSpec');
  const smokeSpec = bindObjectField('smokeSpec');

  function setView(v: WeaponViewMode) {
    viewMode.value = v;
    selected.value = null;
    hovered.value = null;
    activeTarget.value = null;
    inspectorLock.value = null;
    mirrorPair.value = null;
    draw();
  }
  function setField(key: string, value: RowData[string]) {
    localWeapon.value[key] = value;
    commitEdit();
  }
  function onSpecClassChange(specClass: WeaponSpecClass) {
    void commitBefore(() =>
      canvas.runAction(() => {
        beginEdit();
        localWeapon.value = changeWeaponSpecClass(localWeapon.value, specClass);
        commitEdit();
      }),
    );
  }
  function selectBarrel(mode: WeaponViewMode, index: number) {
    viewMode.value = mode;
    selected.value = index;
    hovered.value = { kind: 'barrel', i: index };
    activeTarget.value = { kind: 'barrel', i: index };
    inspectorLock.value = { kind: 'barrel', i: index };
    draw();
  }
  function toCanvas(x: number, y: number) {
    return viewport.toCanvas('ship', x, y);
  }
  function toWeapon(px: number, py: number) {
    const point = viewport.fromCanvas('ship', px, py);
    return { x: snapToStep(point.x), y: snapToStep(point.y) };
  }
  function rawToWeapon(px: number, py: number) {
    return viewport.fromCanvas('ship', px, py);
  }
  function offsetsFor(mode: WeaponViewMode) {
    const key = weaponOffsetsKey(mode);
    if (!Array.isArray(localWeapon.value[key])) localWeapon.value[key] = [];
    return localWeapon.value[key] as number[];
  }
  function anglesFor(mode: WeaponViewMode) {
    const key = weaponAnglesKey(mode);
    if (!Array.isArray(localWeapon.value[key])) localWeapon.value[key] = [];
    return localWeapon.value[key] as number[];
  }
  function barrelCountFor(mode: WeaponViewMode) {
    return Math.floor(offsetsFor(mode).length / 2);
  }
  function currentBarrelSection(): string {
    return viewMode.value === 'turret' ? 'turretBarrels' : 'hardpointBarrels';
  }
  function previewAngle(mx: number, my: number) {
    if (selected.value === null) return 0;
    const origin = { x: offsets.value[selected.value * 2] || 0, y: offsets.value[selected.value * 2 + 1] || 0 };
    return pointAngleScreen(origin, rawToWeapon(mx, my));
  }
  function computePreview(mx: number, my: number, modifiers: CanvasModifiers): BarrelPreview {
    if (modifiers.shiftKey) {
      return { kind: 'add', coord: toWeapon(mx, my) };
    }
    if (modifiers.ctrlKey && selected.value !== null) {
      return { kind: 'angle', angle: previewAngle(mx, my) };
    }
    return null;
  }
  function cursorLabel(coord: { x: number; y: number }): string {
    if (hoverPreview.value?.kind === 'angle') return `${hoverPreview.value.angle}°`;
    return `${coord.x.toFixed(1)}, ${coord.y.toFixed(1)}`;
  }
  function cursorMarker(mx: number, my: number) {
    const coord = toWeapon(mx, my);
    return { point: toCanvas(coord.x, coord.y), label: cursorLabel(coord) };
  }
  function draw() {
    const c = canvasRef.value;
    if (!c) return;
    const pointer = canvas.pointerState();
    const color = arr(localWeapon.value.glowColor, [255, 255, 255, 255]);
    const glow = images.images.get(viewMode.value === 'turret' ? 'turretGlowSprite' : 'hardpointGlowSprite');
    renderWeaponScene(c.getContext('2d')!, {
      base: {
        ...viewport.size(),
        center: viewport.center(),
        scale: scale.value,
        palette: palette.value,
        mirrorY: mirrorMode.value ? toCanvas(0, 0).y : null,
        cursor: pointer.inside ? cursorMarker(pointer.x, pointer.y) : null,
      },
      assets: {
        images: images.images,
        weapon: localWeapon.value,
        mode: viewMode.value,
        scale: scale.value,
        center: viewport.center(),
        glowTint: glow ? images.tintImage(glow, color) : null,
        glowColor: color,
      },
      mirrorMode: mirrorMode.value,
      selected: selected.value,
      hovered: hovered.value,
      offsets: offsets.value,
      angles: angles.value,
      preview: hoverPreview.value,
    });
  }
  function selectableTargets(mx: number, my: number): CanvasTarget[] {
    const targets: CanvasTarget[] = [];
    for (let i = barrelCount.value - 1; i >= 0; i -= 1) {
      const p = toCanvas(offsets.value[i * 2] || 0, offsets.value[i * 2 + 1] || 0);
      targets.push({ kind: 'barrel', i, distance: Math.hypot(mx - p.x, my - p.y) });
    }
    return targets;
  }
  function selectForDown(e: MouseEvent, mx: number, my: number, pick: CanvasPick): CanvasTarget | null {
    if (e.ctrlKey && selected.value !== null)
      return pick.byIdentity(inspectorLock.value) ?? pick.byIdentity(activeTarget.value) ?? pick.byPointer(mx, my);
    return pick.byIdentity(activeTarget.value) ?? pick.byPointer(mx, my);
  }
  function resolveDragKind(e: MouseEvent, _mx: number, _my: number, _target: CanvasTarget, selectedAtDown: number | null) {
    if (e.ctrlKey && selectedAtDown !== null) return 'angle';
    return 'offset';
  }
  function updateInteraction(kind: string, mx: number, my: number) {
    if (kind === 'angle' && selected.value !== null) {
      const angle = previewAngle(mx, my);
      angles.value[selected.value] = angle;
      setPreview({ kind: 'angle', angle });
      return;
    }
    if (kind === 'offset' && selected.value !== null) {
      const coord = toWeapon(mx, my);
      offsets.value[selected.value * 2] = coord.x;
      offsets.value[selected.value * 2 + 1] = coord.y;
    }
  }
  function captureMirrorPair() {
    mirrorPair.value = null;
    if (!mirrorMode.value || selected.value === null) return;
    const index = findMirrorBarrelIndex(offsets.value, selected.value);
    if (index !== null) mirrorPair.value = { kind: 'barrel', i: index };
  }
  function applyMirrorDrag(kind: string) {
    if (kind === 'angle') {
      applyMirrorAngle();
      return;
    }
    if (kind === 'offset' && mirrorMode.value && mirrorPair.value !== null && selected.value !== null) {
      const x = offsets.value[selected.value * 2] || 0;
      const y = offsets.value[selected.value * 2 + 1] || 0;
      offsets.value[mirrorPair.value.i * 2] = mirrorLateral(x);
      offsets.value[mirrorPair.value.i * 2 + 1] = y;
    }
  }
  function applyMirrorAngle() {
    if (!mirrorMode.value || mirrorPair.value === null || selected.value === null) return;
    angles.value[mirrorPair.value.i] = mirrorAngleDeg(angles.value[selected.value] || 0);
  }
  function setOffset(axis: 0 | 1, value: number | null) {
    if (selected.value === null) return;
    offsets.value[selected.value * 2 + axis] = value || 0;
    draw();
    commitEdit();
  }
  function setAngle(value: number | null) {
    if (selected.value === null) return;
    angles.value[selected.value] = value || 0;
    draw();
    commitEdit();
  }
  function addBarrelFor(mode: WeaponViewMode) {
    beginEdit();
    addBarrelAt(mode, { x: 0, y: 0 });
    commitEdit();
    draw();
  }
  function addBarrelAt(mode: WeaponViewMode, coord: { x: number; y: number }) {
    const nextOffsets = offsetsFor(mode);
    const nextAngles = anglesFor(mode);
    const sourceIndex = Math.floor(nextOffsets.length / 2);
    nextOffsets.push(coord.x, coord.y);
    nextAngles.push(0);
    if (mirrorMode.value && Math.abs(coord.x) > MIRROR_EPSILON) {
      nextOffsets.push(mirrorLateral(coord.x), coord.y);
      nextAngles.push(0);
      mirrorPair.value = { kind: 'barrel', i: sourceIndex + 1 };
    } else {
      mirrorPair.value = null;
    }
    viewMode.value = mode;
    selected.value = sourceIndex;
    hovered.value = { kind: 'barrel', i: selected.value };
    activeTarget.value = { kind: 'barrel', i: selected.value };
    inspectorLock.value = null;
  }
  function deleteBarrelFor(mode: WeaponViewMode) {
    if (viewMode.value !== mode || selected.value === null) return;
    beginEdit();
    deleteSelectedBarrelData(mode);
    commitEdit();
    draw();
  }
  function deleteSelectedBarrel(): boolean {
    if (selected.value === null) return false;
    beginEdit();
    deleteSelectedBarrelData(viewMode.value);
    commitEdit();
    draw();
    return true;
  }
  function deleteSelectedBarrelData(mode: WeaponViewMode) {
    if (selected.value === null) return;
    const selectedIndex = selected.value;
    const pairIndex = mirrorMode.value ? findMirrorBarrelIndex(offsetsFor(mode), selectedIndex) : null;
    const indexes = pairIndex === null ? [selectedIndex] : [selectedIndex, pairIndex].sort((a, b) => b - a);
    for (const index of indexes) {
      offsetsFor(mode).splice(index * 2, 2);
      anglesFor(mode).splice(index, 1);
    }
    mirrorPair.value = null;
    selected.value = null;
    hovered.value = null;
    activeTarget.value = null;
    inspectorLock.value = null;
  }
  function actionDown(e: MouseEvent, mx: number, my: number) {
    if (!e.shiftKey) return null;
    beginEdit();
    addBarrelAt(viewMode.value, toWeapon(mx, my));
    return 'offset';
  }
  async function pickWeaponSprite(field: WeaponSpriteField) {
    const accepts = canvas.captureActionContext();
    const relative = await pickModImageReference({ sessionId: props.sessionId, modRoot: props.modRoot, title: '选择武器贴图', accepts });
    if (!relative) return;
    localWeapon.value[field] = relative;
    commitEdit();
  }
  function save() {
    emit('save-requested');
  }
  const palette = useCanvasPalette(draw);
  const frames = useEditorFrameLoop(draw);
  const images = useEditorImages(() => props.spriteData ?? {}, refreshRendering);
  function reloadSprites() {
    images.reload();
  }
  function refreshRendering() {
    if (images.images.has(viewMode.value === 'turret' ? 'turretGlowSprite' : 'hardpointGlowSprite')) frames.start();
    else frames.stop();
    draw();
  }
  watch(() => [viewMode.value, localWeapon.value.glowColor, localWeapon.value.renderHints], refreshRendering, {
    flush: 'post',
  });

  return {
    showProjectileSections,
    showBeamSection,
    localWeapon,
    viewMode,
    expandedSections,
    selected,
    onDown,
    onExpandedSectionsUpdate,
    onLeave,
    onMove,
    onUp,
    onWheel,
    turretSpriteFields,
    hardpointSpriteFields,
    footerNote,
    offsets,
    angles,
    projectileSpecId,
    projectileOptions,
    fringeColor,
    coreColor,
    glowColor,
    muzzleFlashSpec,
    smokeSpec,
    setView,
    setField,
    onSpecClassChange,
    selectBarrel,
    offsetsFor,
    anglesFor,
    barrelCountFor,
    setOffset,
    setAngle,
    addBarrelFor,
    deleteBarrelFor,
    pickWeaponSprite,
    save,
    reloadSprites,
    runAction,
    beginField,
    fieldBlur,
    fieldKey,
  };
}
