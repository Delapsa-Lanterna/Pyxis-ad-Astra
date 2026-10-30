import { testCapabilities } from '../../../testing/capabilities.mjs';
/** @type {Parameters<typeof testCapabilities>[0]} */
const cases = [
  ['config-write', 'src/orchestrators/json-save.orchestrator.ts', 'src/services/json-entity.service.ts', 'saveModInfo'],
  ['definition-write', 'src/orchestrators/json-save.orchestrator.ts', 'src/services/json-file.service.ts', 'saveVariantEntity'],
  ['table-write', 'src/orchestrators/csv-save.orchestrator.ts', 'src/services/csv-table.service.ts', 'saveCsvPatch'],
  ['spec-write', 'src/services/spec-editor.service.ts', 'src/services/spec-editor.service.ts', 'saveSpecEditorSpec'],
  ['text-write', 'src/app/composables/use-file-editor-view-model.ts', 'src/services/files.service.ts', 'writeEditableFileText'],
  ['text-transcode', 'src/app/app-feedback-assembly.ts', 'src/services/files.service.ts', 'transcodeFileToUtf8'],
  [
    'history-replay',
    'src/orchestrators/file-history-replay.orchestrator.ts',
    'src/services/file-history.service.ts',
    'replayFileChangeSet',
  ],
  [
    'wing-joint-query',
    'src/app/composables/immersive-editor/wing/use-immersive-wing-editor.ts',
    'src/services/joint-edit.service.ts',
    'queryJointEditRow',
  ],
  [
    'variant-catalog-query',
    'src/app/composables/immersive-editor/variant/use-variant-catalog.ts',
    'src/services/joint-edit.service.ts',
    'queryJointVariantCatalog',
  ],
  [
    'variant-candidate-query',
    'src/app/composables/immersive-editor/variant/use-variant-candidate.ts',
    'src/services/joint-edit.service.ts',
    'queryJointEdit',
  ],
  ['ship-weapon-candidate', 'src/services/spec-ship-editor.service.ts', 'src/services/joint-edit.service.ts', 'queryJointCandidate'],
  [
    'ship-weapon-sources',
    'src/app/composables/spec-editor/ship/use-spec-ship-weapons.ts',
    'src/services/spec-ship-editor.service.ts',
    'querySpecShipWeaponSources',
  ],
];

testCapabilities(cases);
