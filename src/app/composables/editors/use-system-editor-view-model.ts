import { computed, ref, watch, type EmitFn } from 'vue';
import { useFieldInputActions } from '@/app/composables/use-field-input-actions';
import type { JsonValue, RowData, EditContext } from '@/shared/types';
import { arr, str } from '@/shared/lib/starsector';
import { normalizeSystemSpec } from '@/domain/editors/lib/normalize';
import { createSystemSpec } from '@/domain/editors/spec-construction';
import { SYSTEM_STRUCTURED_FIELD_KEYS } from '@/domain/editors/lib/system-fields';
import { useObjectField } from '@/app/composables/editors/use-object-field';

export interface SystemEditorProps {
  systemId: string;
  system?: RowData;
  editContext: EditContext | null;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  externalUpdateNotice: string;
}
export type SystemEditorEvents = { close: []; 'save-requested': []; 'draft-changed': [system: RowData]; 'load-external': [] };

export function useSystemEditorViewModel(props: Readonly<SystemEditorProps>, emit: EmitFn<SystemEditorEvents>) {
  const localSystem = ref<RowData>(normalizeSystemSpec(props.system || createSystemSpec(props.systemId)));
  const { commitBefore } = useFieldInputActions();
  const expandedSections = ref(['basic']);
  const { bindObjectField } = useObjectField(localSystem, { onCommit: commitEdit });

  const AI_TYPES = [
    'BURN_DRIVE',
    'BURN_DRIVE_TOGGLE',
    'MANEUVERING_JETS',
    'PHASE_CLOAK',
    'PHASE_DISPLACER',
    'FORTRESS_SHIELD',
    'DAMPER_FIELD',
    'TEMPORAL_SHELL',
    'ACAUSAL_DISRUPTOR',
    'WEAPON_BOOST',
    'FLARE',
    'CANISTER_FLAK',
    'DRONE_LAUNCHER_PD',
    'DRONE_STRIKE',
    'RESERVE_DEPLOYMENT',
    'MOTE_ATTRACTOR',
    'CUSTOM',
    'NONE',
  ] as const;

  const systemType = computed(() => str(localSystem.value.type, 'STAT_MOD'));
  const aiType = computed(() => str(localSystem.value.aiType, 'NONE'));
  const showCustomAi = computed(() => aiType.value === 'CUSTOM');
  const showDisplacerSection = computed(() => systemType.value === 'DISPLACER' || systemType.value === 'TELEPORTER');
  const showWeaponSection = computed(() => systemType.value === 'WEAPON');
  const showDroneSection = computed(() => systemType.value === 'DRONE_LAUNCHER');

  const engineGlowColor = computed({
    get: () => arr(localSystem.value.engineGlowColor, [255, 175, 125, 255]),
    set: (v) => setField('engineGlowColor', v),
  });
  const engineGlowContrailColor = computed({
    get: () => arr(localSystem.value.engineGlowContrailColor, [255, 175, 125, 255]),
    set: (v) => setField('engineGlowContrailColor', v),
  });
  const weaponGlowColor = computed({
    get: () => arr(localSystem.value.weaponGlowColor, [255, 255, 255, 255]),
    set: (v) => setField('weaponGlowColor', v),
  });
  const jitterColor = computed({
    get: () => arr(localSystem.value.jitterColor, [255, 255, 255, 255]),
    set: (v) => setField('jitterColor', v),
  });
  const jitterUnderColor = computed({
    get: () => arr(localSystem.value.jitterUnderColor, [255, 255, 255, 255]),
    set: (v) => setField('jitterUnderColor', v),
  });
  const effectColor1 = computed({
    get: () => arr(localSystem.value.effectColor1, [100, 50, 200, 255]),
    set: (v) => setField('effectColor1', v),
  });
  const effectColor2 = computed({
    get: () => arr(localSystem.value.effectColor2, [150, 75, 255, 255]),
    set: (v) => setField('effectColor2', v),
  });
  const shieldRingColor = computed({
    get: () => arr(localSystem.value.shieldRingColor, [100, 200, 255, 255]),
    set: (v) => setField('shieldRingColor', v),
  });
  const shieldInnerColor = computed({
    get: () => arr(localSystem.value.shieldInnerColor, [100, 200, 255, 75]),
    set: (v) => setField('shieldInnerColor', v),
  });

  const aiHintsJson = bindObjectField('aiHints');

  function commitEdit() {
    emit('draft-changed', localSystem.value);
  }
  function setField(key: string, value: RowData[string]) {
    localSystem.value[key] = value;
    commitEdit();
  }

  function droneBehaviorUpdated(value: JsonValue[]) {
    localSystem.value.droneBehavior = value;
    commitEdit();
  }

  const structuredKnownKeys = [...SYSTEM_STRUCTURED_FIELD_KEYS];

  const extraFields = computed<RowData>(() =>
    Object.fromEntries(Object.entries(localSystem.value).filter(([key]) => !SYSTEM_STRUCTURED_FIELD_KEYS.has(key))),
  );

  function onExtraUpdate(nextExtra: RowData) {
    const structured = Object.fromEntries(Object.entries(localSystem.value).filter(([key]) => SYSTEM_STRUCTURED_FIELD_KEYS.has(key)));
    localSystem.value = { ...structured, ...nextExtra };
    commitEdit();
  }

  function onTypeChange(newType: string) {
    void commitBefore(() => {
      localSystem.value.type = newType;
      commitEdit();
    });
  }

  watch(
    () => props.editContext,
    () => {
      if (props.editContext?.handoff === 'save') return;
      localSystem.value = normalizeSystemSpec(props.system || createSystemSpec(props.systemId));
    },
  );
  return {
    showCustomAi,
    localSystem,
    expandedSections,
    AI_TYPES,
    systemType,
    aiType,
    showDisplacerSection,
    showWeaponSection,
    showDroneSection,
    engineGlowColor,
    engineGlowContrailColor,
    weaponGlowColor,
    jitterColor,
    jitterUnderColor,
    effectColor1,
    effectColor2,
    shieldRingColor,
    shieldInnerColor,
    aiHintsJson,
    setField,
    droneBehaviorUpdated,
    structuredKnownKeys,
    extraFields,
    onExtraUpdate,
    onTypeChange,
  };
}
