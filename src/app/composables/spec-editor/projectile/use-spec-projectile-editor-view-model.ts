import { computed, reactive, ref, watch, onMounted, onScopeDispose, type EmitFn, type ShallowRef } from 'vue';
import { useEditorDocument } from '../../editors/use-editor-document';
import { createSpecObject, updateSpecField } from '@/domain/editors/spec-construction';
import { projectileSections, projectileSpecIssues } from '@/domain/spec-editor/projectile/spec-projectile-fields';
import { useSpecProblems } from '../use-spec-problems';
import { useSettingsStore } from '@/stores/settings.store';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';

import type { RowData, EditContext, ProjectileSpecClass, ResourceRef } from '@/shared/types/index';
import { str } from '@/shared/lib/starsector/index';
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
import { useProjectileRendering } from '../../editors/use-projectile-rendering';
import { useEngineRendering } from '../../editors/use-engine-rendering';

export interface SpecProjectileEditorProps {
  modRoot: string;
  sessionId: string;
  projectileId: string;
  projectile?: RowData;
  spriteData?: Record<string, string>;
  resourceRefs?: readonly ResourceRef[];
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
    editorWindowRef: Readonly<ShallowRef<HTMLElement | null>>;
    stageRef: Readonly<ShallowRef<HTMLElement | null>>;
    canvasRef: Readonly<ShallowRef<HTMLCanvasElement | null>>;
  },
) {
  const { editorWindowRef, stageRef, canvasRef } = elements;
  const settings = useSettingsStore();
  const viewport = useCanvasViewport(canvasRef, 1, 20);
  const document = useEditorDocument({
    source: () => props.projectile || createProjectileSpec(props.projectileId),
    normalize: normalizeProjectileSpec,
    context: computed(() => props.editContext),
    publish: (value) => emit('draft-changed', value),
    historyLimit: computed(() => settings.editHistoryLimit),
    contains: (element) => Boolean(editorWindowRef.value?.contains(element)),
    draw,
  });
  const localProjectile = document.value;
  useShortcutDispatch({ commands: { undo: () => void document.undo(), redo: () => void document.redo() } });

  const expandedSections = ref(['basic']);
  const geometry = computed(() => projectProjectileGeometry(localProjectile.value));
  const engines = useEngineRendering(
    () => props.sessionId,
    draw,
    () => geometry.value.engines,
  );
  const palette = useCanvasPalette(draw),
    navigation = useCanvasNavigation(viewport, draw, 'pointer');
  const decodeError = ref('');
  const images = useProjectileRendering(
    () => props.sessionId,
    () => props.resourceRefs ?? [],
    draw,
    (resource) => props.spriteData?.[resource.key] ?? '',
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
    if (props.spriteError) return props.spriteError;
    if (!geometry.value.spritePath) return '';
    if (props.spriteLoading) return '正在读取贴图…';
    if (decodeError.value) return decodeError.value;
    if (props.spriteData?.[geometry.value.spriteField] && !images.ready.value) return '正在加载贴图…';
    return '';
  });
  useSpecProblems(() => [
    ...projectileSpecIssues(localProjectile.value),
    ...[props.spriteError, decodeError.value, ...(engines.notices?.value ?? [])]
      .filter((message): message is string => Boolean(message))
      .map((message) => ({ severity: 'warning' as const, code: 'spec.preview', path: message, message })),
  ]);
  function draw() {
    const ctx = canvasRef.value?.getContext('2d');
    if (!ctx) return;
    const dimensions = viewport.size();
    images.paint((providers) =>
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
          images: providers(Object.fromEntries((props.resourceRefs ?? []).map((resource) => [resource.key, resource]))),
        }),
      ),
    );
  }
  function resetView() {
    const dimensions = viewport.size(),
      extent = geometry.value.extent;
    viewport.fit(
      Math.max(
        0.1,
        Math.min(
          20,
          Math.max(1, dimensions.width - 80) / Math.max(1, extent.x * 2),
          Math.max(1, dimensions.height - 80) / Math.max(1, extent.y * 2),
        ),
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

  const specClass = computed(() => str(localProjectile.value.specClass, 'projectile'));
  const showMissileSections = computed(() => specClass.value === 'missile');
  const engineSlots = computed<RowData[]>(() =>
    Array.isArray(localProjectile.value.engineSlots) ? (localProjectile.value.engineSlots as RowData[]) : [],
  );
  const sections = computed(() => projectileSections(showMissileSections.value));
  const spriteSize = computed(() => {
    void images.ready.value;
    const ref = props.resourceRefs?.find((item) => item.key === geometry.value.spriteField && item.relPath === geometry.value.spritePath);
    const size = ref ? images.image(ref) : null;
    return size ? [size.width, size.height] : [0, 0];
  });
  function setProperty(path: string, value: RowData[string]) {
    if (path === 'specClass') {
      onSpecClassChange(value as ProjectileSpecClass);
      return;
    }
    if (path === 'missileType') {
      void document.command((projectile) => updateSpecField(projectile, path, value));
      return;
    }
    document.change((projectile) => updateSpecField(projectile, path, value));
  }

  function onSpecClassChange(kind: ProjectileSpecClass) {
    void document.command(() => {
      localProjectile.value = changeProjectileSpecClass(localProjectile.value, kind);
    });
  }
  function addEngineSlot() {
    document.command((projectile) => {
      const slots = projectile.engineSlots as RowData[];
      slots.push(createProjectileEngineSlot(slots));
    });
  }
  function removeEngineSlot(i: number) {
    const slot = engineSlots.value[i]!;
    document.command((projectile) => {
      const slots = projectile.engineSlots as RowData[];
      slots.splice(slots.indexOf(slot), 1);
    });
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
      fitted: viewport.fitted,
      expandedSections,
      engineSlots,
      spriteNotice,
      sections,
      spriteSize,
      engineStyles: engines.styleNames,
      canSyncSprite: computed(() => spriteSize.value[0]! > 0),
    }),
    actions: {
      removeField: (path: string) => document.change((projectile) => updateSpecField(projectile, path, undefined)),
      setProperty,
      removeProperty: (path: string) => document.command((projectile) => updateSpecField(projectile, path, undefined)),
      addExplosion: () =>
        document.command((projectile) => {
          projectile.explosionSpec = createSpecObject('explosionSpec');
        }),
      createInlineStyle: (index: number) => {
        const slot = engineSlots.value[index]!;
        return document.command(() => {
          slot.style = 'CUSTOM';
          delete slot.styleId;
          slot.styleSpec ??= createSpecObject('styleSpec');
        });
      },
      syncSize: () => {
        const size = [...spriteSize.value];
        return document.command((projectile) => {
          projectile.size = size;
        });
      },
      syncCenter: () => {
        const center = spriteSize.value.map((value) => value / 2);
        return document.command((projectile) => {
          projectile.center = center;
        });
      },
      resetView,
      addEngineSlot,
      removeEngineSlot,
    },
  };
}
