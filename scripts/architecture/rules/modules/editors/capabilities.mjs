import { capabilities, readOwners } from '../../capabilities/owners.mjs';

export const editorsCapabilities = [
  ...capabilities({ role: 'service', domain: 'weapon-data' }, [
    {
      capability: 'weapon-data-read',
      names: ['queryWeaponData', 'queryWeaponSpecData', 'queryWeaponSprites'],
      owners: [
        { layer: 'services', domain: 'spec-weapon-editor' },
        { layer: 'services', domain: 'weapon-fire-preview' },
      ],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'spec-weapon-editor' }, [
    {
      capability: 'weapon-editor-read',
      names: ['querySpecWeaponEditorData'],
      owners: [{ layer: 'app', role: 'composable', domain: 'spec-editor-assembly' }],
    },
    {
      capability: 'spec-weapon-editor-dependencies',
      names: ['querySpecWeaponEditorImages', 'querySpecWeaponProjectileOptions'],
      owners: [{ layer: 'app', role: 'composable', domain: 'spec-weapon-editor-dependencies' }],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'spec-projectile-editor' }, [
    {
      capability: 'projectile-editor-read',
      names: ['querySpecProjectileEditorData', 'querySpecProjectileEditorImages'],
      owners: [{ layer: 'app', role: 'composable', domain: 'spec-editor-assembly' }],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'weapon-fire-preview' }, [
    {
      capability: 'weapon-fire-preview-read',
      names: ['queryWeaponFirePreviewData'],
      owners: [{ layer: 'app', role: 'composable', domain: 'weapon-fire-preview-window-view-model' }],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'joint-edit' }, [
    { capability: 'cache-observe', names: ['hasJointEditInvalidation'], owners: readOwners },
    {
      capability: 'joint-edit-read',
      names: ['queryJointEdit', 'queryJointEditRow', 'queryJointEditProjection', 'queryJointVariantCatalog', 'prepareJointEdit'],
      owners: [
        { layer: 'orchestrators', domain: 'joint-edit' },
        { layer: 'app', role: 'composable', domain: 'joint-edit-session' },
        { layer: 'app', role: 'composable', domain: 'immersive-editor-runtime' },
        { layer: 'app', role: 'composable', domain: 'immersive-variant-editor' },
        { layer: 'app', role: 'composable', domain: 'immersive-wing-editor' },
        { layer: 'app', role: 'composable', domain: 'variant-catalog' },
        { layer: 'app', role: 'composable', domain: 'variant-candidate' },
      ],
    },
    {
      capability: 'joint-candidate-read',
      names: ['queryJointCandidate'],
      owners: [
        { layer: 'orchestrators', domain: 'joint-edit' },
        { layer: 'app', role: 'composable', domain: 'joint-edit-session' },
        { layer: 'app', role: 'composable', domain: 'variant-catalog' },
        { layer: 'app', role: 'composable', domain: 'variant-candidate' },
        { layer: 'services', domain: 'spec-ship-editor' },
      ],
    },
    { capability: 'joint-edit-write', names: ['saveJointEdit'], owners: [{ layer: 'orchestrators', domain: 'joint-edit' }] },
  ]),
  ...capabilities({ role: 'service', domain: 'csv-table' }, [
    {
      capability: 'table-query',
      names: ['queryTableIndex', 'queryTableRows', 'querySessionCsvRowPreview', 'queryTableRowPreviewDataUrl'],
      owners: readOwners,
    },
    {
      capability: 'table-identity-prepare',
      names: ['prepareCsvAssociatedSpecs'],
      owners: [{ layer: 'orchestrators', domain: 'csv-save' }],
    },
    { capability: 'table-write', names: ['saveCsvPatch'], owners: [{ layer: 'orchestrators', domain: 'csv-save' }] },
  ]),
  ...capabilities({ role: 'service', domain: 'json-entity' }, [
    {
      capability: 'config-write',
      names: ['saveModInfo', 'saveIndexedConfigEntity', 'createIndexedConfigEntity'],
      owners: [{ layer: 'orchestrators', domain: 'json-save' }],
    },
    {
      capability: 'config-delete',
      names: ['deleteIndexedConfigEntity'],
      owners: [{ layer: 'app', role: 'composable', domain: 'json-document-capabilities' }],
    },
    {
      capability: 'config-query',
      names: ['captureConfigIdentityIntent', 'queryFactionPreviewImages', 'queryMissionDraftIcon'],
      owners: readOwners,
    },
  ]),
  ...capabilities({ role: 'service', domain: 'json-file' }, [
    {
      capability: 'config-write',
      names: ['saveVariantEntity', 'createVariantEntity', 'saveSkinEntity', 'createSkinEntity'],
      owners: [{ layer: 'orchestrators', domain: 'json-save' }],
    },
    {
      capability: 'config-delete',
      names: ['deleteVariantEntity', 'deleteSkinEntity'],
      owners: [{ layer: 'app', role: 'composable', domain: 'json-document-capabilities' }],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'spec-editor' }, [
    {
      capability: 'spec-write',
      names: ['saveSpecEditorSpec', 'saveSpecEditorSpecByKind'],
      owners: readOwners,
    },
    {
      capability: 'editor-query',
      names: ['querySpecEditorIdentityIntent'],
      owners: readOwners,
    },
    {
      capability: 'spec-import',
      names: ['loadSpecEditorImport'],
      owners: readOwners,
    },
  ]),
  ...capabilities({ role: 'service', domain: 'spec-ship-editor' }, [
    {
      capability: 'spec-ship-editor-read',
      names: ['querySpecShipEditorData', 'querySpecShipEditorImages', 'querySpecShipWeaponSources'],
      owners: readOwners,
    },
  ]),
  ...capabilities({ role: 'service', domain: 'spec-system-editor' }, [
    {
      capability: 'spec-system-editor-read',
      names: ['querySpecSystemEditorData'],
      owners: readOwners,
    },
  ]),
  ...capabilities({ role: 'service', domain: 'files' }, [
    {
      capability: 'text-write',
      names: ['writeEditableFileText', 'transcodeFileToUtf8'],
      owners: [
        { layer: 'services' },
        { layer: 'orchestrators' },
        { layer: 'app', role: 'composable' },
        { path: 'src/app/app-feedback-assembly.ts', layer: 'app' },
      ],
    },
    {
      capability: 'text-read',
      names: ['loadEditableFileData', 'queryFileTextIdentityIntent', 'followFileTextIdentity'],
      owners: readOwners,
    },
  ]),
  ...capabilities({ role: 'service', domain: 'file-history' }, [
    { capability: 'history-replay', names: ['replayFileChangeSet'], owners: [{ layer: 'orchestrators', domain: 'file-history-replay' }] },
    {
      capability: 'history-wire',
      names: ['loadFileHistory', 'clearSavedFileHistory'],
      owners: readOwners,
    },
  ]),
];
