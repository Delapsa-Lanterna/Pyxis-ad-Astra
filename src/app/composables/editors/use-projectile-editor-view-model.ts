import { computed, reactive, ref, type EmitFn } from 'vue';
import { useEditorDocument } from './use-editor-document';
import { useEditorFields } from './use-editor-fields';

import type { RowData, EditContext, ProjectileSpecClass } from '@/shared/types';
import { arr, str } from '@/shared/lib/starsector';
import { changeProjectileSpecClass, createProjectileSpec } from '@/domain/editors/spec-construction';
import { normalizeProjectileSpec } from '@/domain/editors/lib/normalize';
import { createProjectileEngineSlot } from '@/domain/editors/lib/projectile-fields';

import { useResourceReference } from '@/app/composables/editors/use-resource-reference';

export interface ProjectileEditorProps {
  modRoot: string;
  sessionId: string;
  projectileId: string;
  projectile?: RowData;
  editContext: EditContext | null;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  externalUpdateNotice: string;
}
export type ProjectileEditorEvents = {
  close: [];
  'save-requested': [];
  'draft-changed': [projectile: RowData];
  'load-external': [];
};

export function useProjectileEditorViewModel(props: Readonly<ProjectileEditorProps>, emit: EmitFn<ProjectileEditorEvents>) {
  const document = useEditorDocument({
    source: () => props.projectile || createProjectileSpec(props.projectileId),
    normalize: normalizeProjectileSpec,
    context: computed(() => props.editContext),
    publish: (value) => emit('draft-changed', value),
  });
  const localProjectile = document.value,
    fields = useEditorFields(document);

  const expandedSections = ref(['basic']);

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
    }),
    actions: {
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
