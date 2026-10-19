import { computed, reactive, ref, watch, onMounted, onScopeDispose, type EmitFn, type ShallowRef } from 'vue';
import { useEditorDocument } from '../../editors/use-editor-document';
import { useEditorFields } from '../../editors/use-editor-fields';

import type { RowData, EditContext, ProjectileSpecClass } from '@/shared/types/index';
import { arr, str } from '@/shared/lib/starsector/index';
import {
  changeProjectileSpecClass,
  createProjectileSpec,
  normalizeProjectileSpec,
  createProjectileEngineSlot,
  projectProjectileGeometry,
} from '@/domain/spec-editor/projectile/spec-projectile-model';

import { renderSpecProjectileEditorScene } from '@/app/renderers/spec-editor/projectile/spec-projectile-scene';
import { useCanvasViewport } from '@/app/composables/canvas/use-canvas-viewport';
import { useCanvasNavigation } from '@/app/composables/canvas/use-canvas-navigation';
import { watchCanvasPixelRatio } from '@/app/composables/canvas/use-canvas-surface';
import { useCanvasPalette } from '@/app/composables/canvas/use-canvas-palette';
import { useEditorImages } from '../../editors/use-editor-images';
import { useEngineRendering } from '../../editors/use-engine-rendering';
import { useResourceReference } from '@/app/composables/editors/use-resource-reference';

export interface SpecProjectileEditorProps {
  modRoot: string;
  sessionId: string;
  projectileId: string;
  projectile?: RowData;
  spriteData?: Record<string, string>;
  spriteLoading?: boolean;
  spriteError?: string;
  editContext: EditContext | null;
  path?: string;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  externalUpdateNotice: string;
}
export type SpecProjectileEditorEvents = {
  close: [];
  'reset-requested': [];
  'save-requested': [];
  'draft-changed': [projectile: RowData];
  'load-external': [];
};

export function useSpecProjectileEditorViewModel(
  props: Readonly<SpecProjectileEditorProps>,
  emit: EmitFn<SpecProjectileEditorEvents>,
  elements: {
    stageRef: Readonly<ShallowRef<HTMLElement | null>>;
    canvasRef: Readonly<ShallowRef<HTMLCanvasElement | null>>;
  },
) {
  const { stageRef, canvasRef } = elements;
  const viewport = useCanvasViewport(canvasRef, 1, 20);
  const document = useEditorDocument({
    source: () => props.projectile || createProjectileSpec(props.projectileId),
    normalize: normalizeProjectileSpec,
    context: computed(() => props.editContext),
    publish: (value) => emit('draft-changed', value),
    draw,
  });
  const localProjectile = document.value,
    fields = useEditorFields(document);

  const expandedSections = ref(['basic']);
  const geometry = computed(() => projectProjectileGeometry(localProjectile.value));
  const engines = useEngineRendering(
    () => props.sessionId,
    draw,
    () => geometry.value.engines.length > 0,
  );
  const palette = useCanvasPalette(draw),
    navigation = useCanvasNavigation(viewport, draw, 'pointer');
  const decodeError = ref('');
  const images = useEditorImages(
    () => props.spriteData ?? {},
    draw,
    () => {
      decodeError.value = '无法解码贴图：' + geometry.value.spritePath;
    },
  );
  watch(
    () => props.spriteData,
    () => {
      decodeError.value = '';
    },
    { flush: 'sync' },
  );
  const spriteNotice = computed(() => {
    void images.revision.value;
    if (props.spriteError) return props.spriteError;
    if (!geometry.value.spritePath) return '';
    if (props.spriteLoading) return '正在读取贴图…';
    if (decodeError.value) return decodeError.value;
    if (props.spriteData?.[geometry.value.spriteField] && !images.images.has(geometry.value.spriteField)) return '正在加载贴图…';
    return '';
  });
  function draw() {
    const ctx = canvasRef.value?.getContext('2d');
    if (!ctx) return;
    const dimensions = viewport.size();
    engines.paint((engineImages) =>
      renderSpecProjectileEditorScene(ctx, {
        engineImages,
        base: {
          ...dimensions,
          center: viewport.center(),
          scale: viewport.scale.value,
          palette: palette.value,
          mirrorY: null,
          cursor: null,
        },
        geometry: geometry.value,
        sprite: images.images.get(geometry.value.spriteField) ?? null,
      }),
    );
  }
  function resetView() {
    const dimensions = viewport.size(),
      extent = geometry.value.extent;
    viewport.pan.value = { x: 0, y: 0 };
    viewport.scale.value = Math.max(
      0.1,
      Math.min(
        20,
        Math.max(1, dimensions.width - 80) / Math.max(1, extent.x * 2),
        Math.max(1, dimensions.height - 80) / Math.max(1, extent.y * 2),
      ),
    );
    draw();
  }
  function resize() {
    const rect = stageRef.value?.getBoundingClientRect();
    if (viewport.resize(rect?.width, rect?.height)) draw();
  }
  let stopDpi: (() => void) | undefined;
  onMounted(() => {
    resize();
    resetView();
    stopDpi = watchCanvasPixelRatio(resize);
    window.addEventListener('resize', resize);
  });
  onScopeDispose(() => {
    navigation.finish();
    stopDpi?.();
    window.removeEventListener('resize', resize);
  });

  const { pickModImageReference } = useResourceReference();
  const specClass = computed(() => str(localProjectile.value.specClass, 'projectile'));
  const showProjectileSections = computed(() => specClass.value === 'projectile');
  const showMissileSections = computed(() => specClass.value === 'missile');
  const size = computed(() => arr(localProjectile.value.size, [0, 0]));
  const center = computed(() => arr(localProjectile.value.center, [0, 0]));
  const engineSlots = computed<RowData[]>(() =>
    Array.isArray(localProjectile.value.engineSlots) ? (localProjectile.value.engineSlots as RowData[]) : [],
  );
  const fringeColor = fields.color('fringeColor', [255, 255, 255, 255]);
  const coreColor = fields.color('coreColor', [255, 255, 255, 255]);
  const explosionColor = fields.color('explosionColor', [255, 200, 50, 255]);
  const engineSpec = fields.object('engineSpec');
  const explosionSpec = fields.object('explosionSpec');

  function setField(key: string, value: RowData[string]) {
    fields.set(key, value);
  }
  function onSpecClassChange(kind: ProjectileSpecClass) {
    void document.command(() => {
      localProjectile.value = changeProjectileSpecClass(localProjectile.value, kind);
    });
  }
  function setArray(key: string, index: number, value: number | null) {
    fields.array(key, index, value);
  }
  function slotLoc(slot: RowData) {
    return arr(slot.loc, [0, 0]);
  }
  function setSlotLoc(i: number, axis: number, value: number | null) {
    document.change((projectile) => {
      const slot = (projectile.engineSlots as RowData[])[i]!,
        loc = arr(slot.loc, [0, 0]);
      loc[axis] = value || 0;
      slot.loc = loc;
    });
  }
  function addEngineSlot() {
    document.change((projectile) => {
      const slots = projectile.engineSlots as RowData[];
      slots.push(createProjectileEngineSlot(slots));
    });
  }
  function removeEngineSlot(i: number) {
    document.change((projectile) => {
      (projectile.engineSlots as RowData[]).splice(i, 1);
    });
  }
  function projectileUpdated(value: RowData) {
    document.change(() => {
      localProjectile.value = value;
    });
  }
  async function pickProjectileSprite(field: 'bulletSprite' | 'sprite') {
    const accepts = document.captureActionContext();
    const relative = await pickModImageReference({ sessionId: props.sessionId, modRoot: props.modRoot, title: '选择弹体贴图', accepts });
    if (!relative) return;
    setField(field, relative);
  }

  return {
    canvas: {
      onDown: navigation.start,
      onMove: navigation.move,
      onUp: navigation.finish,
      onLeave: navigation.finish,
      onWheel: navigation.wheel,
      beginField: document.beginField,
      fieldBlur: document.fieldBlur,
      fieldKey: document.fieldKey,
    },
    document: localProjectile,
    view: reactive({
      showProjectileSections,
      showMissileSections,
      normalizeProjectile: normalizeProjectileSpec,
      expandedSections,
      size,
      center,
      engineSlots,
      fringeColor,
      coreColor,
      explosionColor,
      engineSpec,
      explosionSpec,
      slotLoc,
      spriteNotice,
    }),
    actions: {
      resetView,
      setField,
      onSpecClassChange,
      setArray,
      setSlotLoc,
      addEngineSlot,
      removeEngineSlot,
      projectileUpdated,
      pickProjectileSprite,
    },
  };
}
