import { useEditorFields } from '../../editors/use-editor-fields';
import { weaponCanvasPoint, weaponPointFromCanvas } from '@/domain/editors/lib/geometry';
import { computed, reactive, ref, type EmitFn, type ShallowRef } from 'vue';
import type { RowData, EditContext, WeaponSpecClass } from '@/shared/types/index';
import type { WeaponOperationPreview } from '@/domain/editors/editor-types';
import { str, deepClone } from '@/shared/lib/starsector/index';
import { normalizeWeaponSpec, changeWeaponSpecClass } from '@/domain/editors/weapon-spec';
import { createSpecObject, updateSpecField } from '@/domain/editors/spec-construction';
import { weaponSections, weaponSpecIssues } from '@/domain/spec-editor/weapon/spec-weapon-fields';
import { useSpecProblems } from '../use-spec-problems';

import {
  projectWeaponBarrels,
  weaponOperationKind,
  previewWeaponOperation,
  addWeaponBarrel,
  updateWeaponBarrel,
  deleteWeaponBarrel,
} from '@/domain/spec-editor/weapon/spec-weapon-editing';
import { findMirrorBarrelIndex } from '@/domain/editors/lib/mirror';
import type { WeaponViewMode } from '@/shared/lib/starsector/weapon-sprite-fields';
import { useEditorDocument } from '../../editors/use-editor-document';
import { createCanvasState } from '@/app/composables/canvas/use-canvas-state';
import { useCanvasEditor } from '@/app/composables/canvas/use-canvas-editor';
import { useCanvasViewport } from '@/app/composables/canvas/use-canvas-viewport';
import { useCanvasPalette } from '@/app/composables/canvas/use-canvas-palette';
import { useEditorImages } from '../../editors/use-editor-images';
import { useEditorFrameLoop } from '../../editors/use-editor-frame-loop';
import { renderSpecWeaponEditorScene } from '@/app/renderers/spec-editor/weapon/spec-weapon-scene';
import { useSettingsStore } from '@/stores/settings.store';
export interface SpecWeaponEditorProps {
  modRoot: string;
  sessionId: string;
  weaponId: string;
  weapon: RowData;
  spriteData?: Record<string, string>;
  editContext: EditContext | null;
  path?: string;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  externalUpdateNotice: string;
}
export type SpecWeaponEditorEvents = {
  close: [];
  'reset-requested': [];
  'save-requested': [];
  'draft-changed': [weapon: RowData];
  'load-external': [];
  'edit-projectile': [id: string];
  preview: [weapon: RowData];
};
export function useSpecWeaponEditorViewModel(
  props: Readonly<SpecWeaponEditorProps>,
  emit: EmitFn<SpecWeaponEditorEvents>,
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
    expandedSections = ref<(string | number)[]>(['basic']),
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
      canvas.cancelInspectorReveal();
      viewMode.value = mode;
      state.reset();
      refreshRendering();
    });
  }
  function selectBarrel(mode: WeaponViewMode, i: number) {
    void canvas.revealInspector(() => {
      viewMode.value = mode;
      state.select({ kind: 'barrel', i }, true);
      refreshRendering();
    });
  }
  function addBarrelFor(mode: WeaponViewMode) {
    void document.command((weapon) => {
      canvas.cancelInspectorReveal();
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
      inspector: () =>
        state.target.value && {
          section: viewMode.value === 'turret' ? 'turretBarrels' : 'hardpointBarrels',
          selector: `[data-inspector-target="${viewMode.value}-barrel-${state.target.value.i}"]`,
          lock: state.target.value,
        },
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
    renderSpecWeaponEditorScene(c.getContext('2d')!, {
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

  const sections = computed(() => weaponSections(localWeapon.value));
  useSpecProblems(() => weaponSpecIssues(localWeapon.value));
  function setProperty(path: string, value: RowData[string]) {
    if (path === 'specClass')
      return document.command(() => {
        localWeapon.value = changeWeaponSpecClass(localWeapon.value, value as WeaponSpecClass);
      });
    document.change((weapon) => updateSpecField(weapon, path, value));
    return undefined;
  }
  return {
    document: localWeapon,
    view: reactive({
      viewMode,
      glowPreviewEnabled,
      expandedSections,
      selected: state.selected,
      mirror: state.mirrorMode,
      fitted: viewport.fitted,
      sections,
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
    }),
    actions: {
      removeField: (path: string) => document.change((weapon) => updateSpecField(weapon, path, undefined)),
      setProperty,
      removeProperty: (path: string) => document.command((weapon) => updateSpecField(weapon, path, undefined)),
      addObject: (key: 'muzzleFlashSpec' | 'smokeSpec') =>
        document.command((weapon) => {
          weapon[key] = createSpecObject(key);
        }),
      toggleMirror: () =>
        document.run(() => {
          state.toggleMirror();
          draw();
        }),
      fitView: () => {
        const dimensions = viewport.size(),
          extent = Math.max(
            1,
            ...[...images.images.values()].flatMap((image) => [image.width, image.height]),
            ...barrels.value.offsets.map((value) => Math.abs(value) * 2),
          );
        viewport.fit(Math.min(20, Math.max(0.1, Math.min(dimensions.width, dimensions.height) / (extent + 80))));
        draw();
      },
      setView,
      toggleGlowPreview: () =>
        document.run(() => {
          glowPreviewEnabled.value = !glowPreviewEnabled.value;
          refreshRendering();
        }),
      selectBarrel,
      addBarrelFor,
      deleteBarrelFor,
      barrelCountFor: (mode: WeaponViewMode) => Math.floor(projectWeaponBarrels(localWeapon.value, mode).offsets.length / 2),
      setOffset: (axis: 0 | 1, value: number | null) =>
        document.change(() => {
          barrels.value.offsets[state.selected.value! * 2 + axis] = value || 0;
        }),
      setAngle: (value: number | null) =>
        document.change(() => {
          barrels.value.angles[state.selected.value!] = value || 0;
        }),
      editProjectile: () =>
        document.run(() => {
          const id = str(localWeapon.value.projectileSpecId);
          if (id) emit('edit-projectile', id);
        }),
      preview: () =>
        document.run(() => {
          document.finish();
          emit('preview', deepClone(localWeapon.value));
        }),
    },
    canvas: { ...canvas, beginField: document.beginField, fieldBlur: document.fieldBlur, fieldKey: document.fieldKey },
  };
}
