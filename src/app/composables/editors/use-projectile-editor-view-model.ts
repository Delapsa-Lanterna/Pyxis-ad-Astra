import { computed, ref, watch, type EmitFn } from 'vue';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import { useEditActionContext } from '@/app/composables/use-edit-action-context';
import type { RowData, EditContext, ProjectileSpecClass } from '@/shared/types';
import { arr, str } from '@/shared/lib/starsector';
import { changeProjectileSpecClass, createProjectileSpec } from '@/domain/editors/spec-construction';
import { normalizeProjectileSpec } from '@/domain/editors/lib/normalize';
import { createProjectileEngineSlot } from '@/domain/editors/lib/projectile-fields';
import { useObjectField } from '@/app/composables/editors/use-object-field';
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
  const localProjectile = ref<RowData>(normalizeProjectileSpec(props.projectile || createProjectileSpec(props.projectileId)));
  const { commitBefore } = useFieldInputActions();
  const expandedSections = ref(['basic']);
  const { bindObjectField } = useObjectField(localProjectile, { onCommit: commitEdit });
  const { pickModImageReference } = useResourceReference();
  const specClass = computed(() => str(localProjectile.value.specClass, 'projectile'));
  const showProjectileSections = computed(() => specClass.value === 'projectile');
  const showMissileSections = computed(() => specClass.value === 'missile');
  const size = computed(() => arr(localProjectile.value.size, [0, 0]));
  const center = computed(() => arr(localProjectile.value.center, [0, 0]));
  const engineSlots = computed<RowData[]>(() =>
    Array.isArray(localProjectile.value.engineSlots) ? (localProjectile.value.engineSlots as RowData[]) : [],
  );
  const fringeColor = computed({
    get: () => arr(localProjectile.value.fringeColor, [255, 255, 255, 255]),
    set: (v) => setField('fringeColor', v),
  });
  const coreColor = computed({
    get: () => arr(localProjectile.value.coreColor, [255, 255, 255, 255]),
    set: (v) => setField('coreColor', v),
  });
  const explosionColor = computed({
    get: () => arr(localProjectile.value.explosionColor, [255, 200, 50, 255]),
    set: (v) => setField('explosionColor', v),
  });
  const engineSpec = bindObjectField('engineSpec');
  const explosionSpec = bindObjectField('explosionSpec');

  function commitEdit() {
    emit('draft-changed', localProjectile.value);
  }
  function setField(key: string, value: RowData[string]) {
    localProjectile.value[key] = value;
    commitEdit();
  }
  function onSpecClassChange(specClass: ProjectileSpecClass) {
    void commitBefore(() => {
      localProjectile.value = changeProjectileSpecClass(localProjectile.value, specClass);
      commitEdit();
    });
  }
  function setArray(key: string, idx: number, value: number | null) {
    const v = arr(localProjectile.value[key], [0, 0]);
    v[idx] = value || 0;
    localProjectile.value[key] = v;
    commitEdit();
  }
  function slotLoc(slot: RowData) {
    return arr(slot.loc, [0, 0]);
  }
  function setSlotLoc(i: number, axis: number, value: number | null) {
    const slot = engineSlots.value[i];
    if (!slot) return;
    const loc = slotLoc(slot);
    loc[axis] = value || 0;
    slot.loc = loc;
    commitEdit();
  }
  function addEngineSlot() {
    engineSlots.value.push(createProjectileEngineSlot(engineSlots.value));
    commitEdit();
  }
  function removeEngineSlot(i: number) {
    engineSlots.value.splice(i, 1);
    commitEdit();
  }
  function projectileUpdated(value: RowData) {
    localProjectile.value = value;
    commitEdit();
  }
  async function pickProjectileSprite(field: 'bulletSprite' | 'sprite') {
    const accepts = captureActionContext();
    const relative = await pickModImageReference({ sessionId: props.sessionId, modRoot: props.modRoot, title: '选择弹体贴图', accepts });
    if (!relative) return;
    setField(field, relative);
  }
  const { captureActionContext } = useEditActionContext(computed(() => props.editContext));
  watch(
    () => props.editContext,
    () => {
      if (props.editContext?.handoff === 'save') return;
      localProjectile.value = normalizeProjectileSpec(props.projectile || { id: props.projectileId, specClass: 'projectile' });
    },
  );
  return {
    showProjectileSections,
    showMissileSections,
    normalizeProjectile: normalizeProjectileSpec,
    localProjectile,
    expandedSections,
    size,
    center,
    engineSlots,
    fringeColor,
    coreColor,
    explosionColor,
    engineSpec,
    explosionSpec,
    setField,
    onSpecClassChange,
    setArray,
    slotLoc,
    setSlotLoc,
    addEngineSlot,
    removeEngineSlot,
    projectileUpdated,
    pickProjectileSprite,
  };
}
