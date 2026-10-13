import { useEditorFields } from './use-editor-fields';
import { weaponCanvasPoint, weaponPointFromCanvas } from '@/domain/editors/lib/geometry';
import { computed, reactive, ref, type EmitFn, type ShallowRef } from 'vue';
import type { RowData, EditContext, WeaponSpecClass } from '@/shared/types';
import type { WeaponOperationPreview } from '@/domain/editors/editor-types';
import { str, deepClone } from '@/shared/lib/starsector';
import { normalizeWeaponSpec } from '@/domain/editors/lib/normalize';
import { changeWeaponSpecClass } from '@/domain/editors/spec-construction';
import {
  projectWeaponBarrels,
  weaponOperationKind,
  previewWeaponOperation,
  addWeaponBarrel,
  updateWeaponBarrel,
  deleteWeaponBarrel,
} from '@/domain/editors/weapon-editing';
import { findMirrorBarrelIndex } from '@/domain/editors/lib/mirror';
import {
  HARDPOINT_WEAPON_SPRITE_FIELDS,
  TURRET_WEAPON_SPRITE_FIELDS,
  type WeaponSpriteField,
  type WeaponViewMode,
} from '@/domain/editors/lib/weapon-sprite-fields';
import { useEditorDocument } from './use-editor-document';
import { createCanvasState } from '@/app/composables/canvas/use-canvas-state';
import { useCanvasEditor } from '@/app/composables/canvas/use-canvas-editor';
import { useCanvasViewport } from '@/app/composables/canvas/use-canvas-viewport';
import { useCanvasPalette } from '@/app/composables/canvas/use-canvas-palette';
import { useEditorImages } from './use-editor-images';
import { useEditorFrameLoop } from './use-editor-frame-loop';
import { useResourceReference } from './use-resource-reference';
import { renderWeaponScene } from '@/app/renderers/editors/weapon-scene';
import { useSettingsStore } from '@/stores/settings.store';
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
  preview: [weapon: RowData];
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
  const { editorWindowRef, stageRef, canvasRef } = elements,
    state = createCanvasState<WeaponOperationPreview>();
  const settings = useSettingsStore();
  const viewMode = ref<WeaponViewMode>('turret'),
    glowPreviewEnabled = ref(false),
    expandedSections = ref(['basic']),
    viewport = useCanvasViewport(canvasRef, 2, 20);
  const document = useEditorDocument({
    source: () => props.weapon,
    normalize: normalizeWeaponSpec,
    context: computed(() => props.editContext),
    publish: (value) => emit('draft-changed', value),
    historyLimit: computed(() => settings.editHistoryLimit),
    contains: (element) => Boolean(editorWindowRef.value?.contains(element)),
    draw: refreshRendering,
    reset: () => {
      state.reset();
      canvas?.reset();
    },
  });
  const fields = useEditorFields(document);
  const glowColor = fields.color('glowColor');
  const localWeapon = document.value,
    barrels = computed(() => projectWeaponBarrels(localWeapon.value, viewMode.value));
  const { pickModImageReference } = useResourceReference();
  const palette = useCanvasPalette(draw),
    frames = useEditorFrameLoop(draw);
  const images = useEditorImages(() => props.spriteData ?? {}, refreshRendering);
  function previewGlowImage() {
    return glowPreviewEnabled.value && glowColor.value[3]! > 0
      ? images.images.get(viewMode.value === 'turret' ? 'turretGlowSprite' : 'hardpointGlowSprite')
      : undefined;
  }
  function refreshRendering() {
    if (previewGlowImage()) frames.start();
    else frames.stop();
    draw();
  }
  const toCanvas = (x: number, y: number) => weaponCanvasPoint({ x, y }, viewport.center(), viewport.scale.value);
  const fromCanvas = (x: number, y: number) => weaponPointFromCanvas({ x, y }, viewport.center(), viewport.scale.value);
  function setView(mode: WeaponViewMode) {
    void document.run(() => {
      viewMode.value = mode;
      state.reset();
      refreshRendering();
    });
  }
  function selectBarrel(mode: WeaponViewMode, i: number) {
    void document.run(() => {
      viewMode.value = mode;
      state.select({ kind: 'barrel', i }, true);
      refreshRendering();
    });
  }
  function addBarrelFor(mode: WeaponViewMode) {
    void document.command((weapon) => {
      const added = addWeaponBarrel(weapon, mode, { x: 0, y: 0 }, state.mirrorMode.value);
      viewMode.value = mode;
      state.select({ kind: 'barrel', i: added.i });
    });
  }
  function deleteBarrelFor(mode: WeaponViewMode) {
    const i = state.selected.value;
    if (mode !== viewMode.value || i === null) return;
    void document.command((weapon) => {
      deleteWeaponBarrel(weapon, mode, i, state.mirrorMode.value);
      state.reset();
    });
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
        Array.from({ length: Math.floor(barrels.value.offsets.length / 2) }, (_, index) => {
          const i = barrels.value.offsets.length / 2 - 1 - index,
            p = toCanvas(barrels.value.offsets[i * 2] || 0, barrels.value.offsets[i * 2 + 1] || 0);
          return { kind: 'barrel', i, distance: Math.hypot(x - p.x, y - p.y) };
        }),
      radius: () => 26,
      begin: (input, pick) => {
        const point = fromCanvas(input.point.x, input.point.y),
          operation = weaponOperationKind(input, state.selected.value);
        let i: number, pair: number | null;
        if (operation === 'add') {
          const added = addWeaponBarrel(
            localWeapon.value,
            viewMode.value,
            { x: Math.round(point.x * 2) / 2, y: Math.round(point.y * 2) / 2 },
            state.mirrorMode.value,
          );
          i = added.i;
          pair = added.pair;
        } else {
          const target =
            input.ctrlKey && state.selected.value !== null
              ? (pick.byIdentity(state.inspectorLock.value) ??
                pick.byIdentity(state.hovered.value) ??
                pick.byPointer(input.point.x, input.point.y))
              : (pick.byIdentity(state.hovered.value) ?? pick.byPointer(input.point.x, input.point.y));
          if (!target) return null;
          i = target.i;
          pair = state.mirrorMode.value ? findMirrorBarrelIndex(barrels.value.offsets, i) : null;
        }
        state.select({ kind: 'barrel', i });
        const kind = operation === 'angle' ? 'angle' : 'offset',
          mode = viewMode.value;
        return {
          kind,
          update: (input) => {
            updateWeaponBarrel(localWeapon.value, mode, i, pair, kind, fromCanvas(input.point.x, input.point.y));
            if (kind === 'angle') state.setPreview({ kind: 'angle', angle: barrels.value.angles[i] || 0 });
          },
        };
      },
      preview: (input) =>
        previewWeaponOperation(localWeapon.value, viewMode.value, state.selected.value, input, fromCanvas(input.point.x, input.point.y)),
      previewTakesOver: (input) => input.shiftKey || input.ctrlKey,
      deleteSelected: () => deleteBarrelFor(viewMode.value),
      shortcuts: { u: () => setView('turret'), h: () => setView('hardpoint') },
      inspector: () => ({
        section: viewMode.value === 'turret' ? 'turretBarrels' : 'hardpointBarrels',
        selector:
          state.selected.value === null ? '' : '[data-inspector-target="' + viewMode.value + '-barrel-' + state.selected.value + '"]',
        lock: state.hovered.value,
      }),
      draw,
    },
  });
  function draw() {
    const c = canvasRef.value;
    if (!c) return;
    const pointer = canvas.pointerState(),
      point = fromCanvas(pointer.x, pointer.y),
      coord = { x: Math.round(point.x * 2) / 2, y: Math.round(point.y * 2) / 2 };
    const glow = previewGlowImage();
    renderWeaponScene(c.getContext('2d')!, {
      base: {
        ...viewport.size(),
        center: viewport.center(),
        scale: viewport.scale.value,
        palette: palette.value,
        mirrorY: state.mirrorMode.value ? toCanvas(0, 0).y : null,
        cursor: pointer.inside
          ? {
              point: toCanvas(coord.x, coord.y),
              label:
                state.preview.value?.kind === 'angle' ? state.preview.value.angle + '°' : coord.x.toFixed(1) + ', ' + coord.y.toFixed(1),
            }
          : null,
      },
      assets: {
        images: images.images,
        weapon: localWeapon.value,
        mode: viewMode.value,
        scale: viewport.scale.value,
        center: viewport.center(),
        glowTint: glow ? images.tintImage(glow, glowColor.value) : null,
        glowColor: glowColor.value,
      },
      mirrorMode: state.mirrorMode.value,
      selected: state.selected.value,
      hovered: state.hovered.value,
      ...barrels.value,
      preview: state.preview.value,
    });
  }

  function setField(key: string, value: RowData[string]) {
    document.change((weapon) => {
      weapon[key] = value;
    });
  }
  async function pickWeaponSprite(field: WeaponSpriteField) {
    const relative = await pickModImageReference({
      sessionId: props.sessionId,
      modRoot: props.modRoot,
      title: '选择武器贴图',
      accepts: document.captureActionContext(),
    });
    if (relative) setField(field, relative);
  }
  return {
    document: localWeapon,
    view: reactive({
      viewMode,
      glowPreviewEnabled,
      expandedSections,
      selected: state.selected,
      turretSpriteFields: TURRET_WEAPON_SPRITE_FIELDS,
      hardpointSpriteFields: HARDPOINT_WEAPON_SPRITE_FIELDS,
      footerNote: computed(
        () =>
          '右键 拖动画布 | 滚轮缩放 | Ctrl+Z 撤销 | Ctrl+Shift+Z 重做' +
          (state.mirrorMode.value ? '（镜像模式）' : '') +
          '\n左键 拖动发射点 | Shift+左键 添加发射点 | Ctrl+左键 设置角度 | 退格 删除发射点 | T 打开' +
          (viewMode.value === 'turret' ? '炮塔' : '固定') +
          '发射点 | 空格 ' +
          (state.mirrorMode.value ? '关闭' : '开启') +
          '镜像',
      ),
      offsets: computed(() => barrels.value.offsets),
      angles: computed(() => barrels.value.angles),
      projectileSpecId: document.field(
        'projectileSpecId',
        (value) => str(value),
        (value) => value,
      ),
      projectileOptions: computed(() => props.projectileOptions),
      fringeColor: fields.color('fringeColor'),
      coreColor: fields.color('coreColor'),
      glowColor,
      muzzleFlashSpec: fields.object('muzzleFlashSpec'),
      smokeSpec: fields.object('smokeSpec'),
      showProjectileSections: computed(() => localWeapon.value.specClass === 'projectile'),
      showBeamSection: computed(() => localWeapon.value.specClass === 'beam'),
    }),
    actions: {
      setView,
      toggleGlowPreview: () =>
        document.run(() => {
          glowPreviewEnabled.value = !glowPreviewEnabled.value;
          refreshRendering();
        }),
      setField,
      selectBarrel,
      addBarrelFor,
      deleteBarrelFor,
      onSpecClassChange: (kind: WeaponSpecClass) =>
        document.command(() => {
          localWeapon.value = changeWeaponSpecClass(localWeapon.value, kind);
        }),
      offsetsFor: (mode: WeaponViewMode) => projectWeaponBarrels(localWeapon.value, mode).offsets,
      anglesFor: (mode: WeaponViewMode) => projectWeaponBarrels(localWeapon.value, mode).angles,
      barrelCountFor: (mode: WeaponViewMode) => Math.floor(projectWeaponBarrels(localWeapon.value, mode).offsets.length / 2),
      setOffset: (axis: 0 | 1, value: number | null) =>
        document.change(() => {
          barrels.value.offsets[state.selected.value! * 2 + axis] = value || 0;
        }),
      setAngle: (value: number | null) =>
        document.change(() => {
          barrels.value.angles[state.selected.value!] = value || 0;
        }),
      pickWeaponSprite: (field: WeaponSpriteField) => document.run(() => void pickWeaponSprite(field)),
      reloadSprites: () => images.reload(),
      preview: () =>
        document.run(() => {
          document.finish();
          emit('preview', deepClone(localWeapon.value));
        }),
      save: () => emit('save-requested'),
    },
    canvas: { ...canvas, beginField: document.beginField, fieldBlur: document.fieldBlur, fieldKey: document.fieldKey },
  };
}
