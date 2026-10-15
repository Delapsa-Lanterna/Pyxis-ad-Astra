import { computed, reactive, ref, type EmitFn } from 'vue';
import { useEditorDocument } from '../../editors/use-editor-document';
import { useEditorFields } from '../../editors/use-editor-fields';
import type { JsonValue, RowData, EditContext } from '@/shared/types/index';
import { str } from '@/shared/lib/starsector/index';
import { normalizeSystemSpec, SYSTEM_STRUCTURED_FIELD_KEYS } from '@/domain/spec-editor/system/spec-system-fields';

import { createSystemSpec } from '@/domain/editors/spec-construction';

export interface SpecSystemEditorProps {
  systemId: string;
  system?: RowData;
  editContext: EditContext | null;
  dirty: boolean;
  canSave: boolean;
  saving: boolean;
  externalUpdateNotice: string;
}
export type SpecSystemEditorEvents = { close: []; 'save-requested': []; 'draft-changed': [system: RowData]; 'load-external': [] };

export function useSpecSystemEditorViewModel(props: Readonly<SpecSystemEditorProps>, emit: EmitFn<SpecSystemEditorEvents>) {
  const document = useEditorDocument({
    source: () => props.system || createSystemSpec(props.systemId),
    normalize: normalizeSystemSpec,
    context: computed(() => props.editContext),
    publish: (value) => emit('draft-changed', value),
  });
  const localSystem = document.value,
    fields = useEditorFields(document);

  const expandedSections = ref(['basic']);

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

  const engineGlowColor = fields.color('engineGlowColor', [255, 175, 125, 255]);
  const engineGlowContrailColor = fields.color('engineGlowContrailColor', [255, 175, 125, 255]);
  const weaponGlowColor = fields.color('weaponGlowColor', [255, 255, 255, 255]);
  const jitterColor = fields.color('jitterColor', [255, 255, 255, 255]);
  const jitterUnderColor = fields.color('jitterUnderColor', [255, 255, 255, 255]);
  const effectColor1 = fields.color('effectColor1', [100, 50, 200, 255]);
  const effectColor2 = fields.color('effectColor2', [150, 75, 255, 255]);
  const shieldRingColor = fields.color('shieldRingColor', [100, 200, 255, 255]);
  const shieldInnerColor = fields.color('shieldInnerColor', [100, 200, 255, 75]);

  const aiHintsJson = fields.object('aiHints');

  function setField(key: string, value: RowData[string]) {
    fields.set(key, value);
  }

  function droneBehaviorUpdated(value: JsonValue[]) {
    fields.set('droneBehavior', value);
  }

  const structuredKnownKeys = [...SYSTEM_STRUCTURED_FIELD_KEYS];

  const extraFields = computed<RowData>(() =>
    Object.fromEntries(Object.entries(localSystem.value).filter(([key]) => !SYSTEM_STRUCTURED_FIELD_KEYS.has(key))),
  );

  function onExtraUpdate(extra: RowData) {
    document.change((value) => {
      const structured = Object.fromEntries(Object.entries(value).filter(([key]) => SYSTEM_STRUCTURED_FIELD_KEYS.has(key)));
      localSystem.value = { ...structured, ...extra };
    });
  }

  function onTypeChange(type: string) {
    void document.command((value) => {
      value.type = type;
    });
  }

  return {
    document: localSystem,
    view: reactive({
      showCustomAi,
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
      structuredKnownKeys,
      extraFields,
    }),
    actions: { setField, droneBehaviorUpdated, onExtraUpdate, onTypeChange },
  };
}
