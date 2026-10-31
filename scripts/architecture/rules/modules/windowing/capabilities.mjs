import { capabilities } from '../../capabilities/owners.mjs';

export const windowsCapabilities = [
  ...capabilities({ role: 'service', domain: 'window' }, [
    {
      capability: 'edit-target-registration',
      names: ['updateEditTargetRegistration'],
      owners: [{ layer: 'app', role: 'composable', domain: 'edit-target-handoff' }],
    },
    {
      capability: 'edit-target-coordination',
      names: ['queryEditTargetOwners', 'reserveEditTargets', 'focusEditTargetOwner'],
      owners: [{ layer: 'orchestrators', domain: 'edit-target-handoff' }],
    },
    {
      capability: 'window-target-focus',
      names: ['focusNativeManagedWindow'],
      owners: [
        { layer: 'orchestrators', domain: 'window-target-focus' },
        { layer: 'orchestrators', domain: 'immersive-editor' },
      ],
    },
    { capability: 'window-open', names: ['requestNativeWindow'], owners: [{ layer: 'windows', domain: 'managed' }] },
    {
      capability: 'window-context',
      names: [
        'getNativeWindowBootstrap',
        'getNativeWindowContext',
        'getNativeWindowRequest',
        'acceptNativeWindowRequest',
        'failNativeWindowRequest',
        'failNativeWindowStartup',
      ],
      owners: [{ layer: 'windows', domain: 'window-context' }],
    },
    {
      capability: 'window-lifecycle-guard',
      names: ['updateNativeWindowStatus'],
      owners: [{ layer: 'app', role: 'composable', domain: 'dirty-window-close-guard' }],
    },
    {
      capability: 'entity-window-identity',
      names: ['reserveNativeWindowTargets'],
      owners: [
        { layer: 'orchestrators', domain: 'edit-target-handoff' },
        { layer: 'orchestrators', domain: 'spec-editor-identity' },
        { layer: 'orchestrators', domain: 'window-identity' },
        { layer: 'orchestrators', domain: 'csv-save' },
        { layer: 'orchestrators', domain: 'json-save' },
      ],
    },
    {
      capability: 'window-target-release',
      names: ['releaseNativeWindowTargets'],
      owners: [
        { layer: 'orchestrators', domain: 'edit-target-handoff' },
        { layer: 'orchestrators', domain: 'spec-editor-identity' },
        { layer: 'orchestrators', domain: 'window-identity' },
        { layer: 'orchestrators', domain: 'csv-save' },
        { layer: 'orchestrators', domain: 'json-save' },
        { layer: 'app', role: 'composable', domain: 'json-document-session' },
        { layer: 'app', role: 'composable', domain: 'json-list-selection' },
        { layer: 'app', role: 'composable', domain: 'spec-editor-window-view-model' },
        { layer: 'app', role: 'composable', domain: 'file-editor-view-model' },
      ],
    },
    {
      capability: 'window-identity-handoff',
      names: ['retargetNativeWindow'],
      owners: [
        { layer: 'orchestrators', domain: 'spec-editor-identity' },
        { layer: 'orchestrators', domain: 'window-identity' },
        { layer: 'orchestrators', domain: 'immersive-editor' },
        { layer: 'orchestrators', domain: 'weapon-fire-preview' },
      ],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'app-lifecycle' }, [
    {
      capability: 'scope-close',
      names: ['requestClose'],
      owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
    },
    {
      capability: 'close-participant',
      names: ['replyNativeClose', 'readyNativeClose'],
      owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
    },
  ]),
  ...capabilities(
    { path: 'src/app/composables/use-window-close-state.ts', layer: 'app', role: 'composable', domain: 'window-close-state' },
    [
      {
        capability: 'window-close-provider',
        names: ['provideWindowCloseState'],
        owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
      },
      {
        capability: 'window-close-consume',
        names: ['useWindowCloseState', 'useWindowLifecycleActions'],
        owners: [
          { layer: 'app', role: 'composable' },
          { layer: 'app', role: 'component' },
        ],
      },
    ],
  ),
  ...capabilities({ role: 'external', domain: '@tauri-apps/api/core' }, [
    {
      capability: 'invoke-wire',
      names: ['invoke'],
      owners: [{ path: 'src/shared/runtime/command.runtime.ts', layer: 'shared', domain: 'runtime' }],
    },
  ]),
];
