import { testCapabilities } from '../../../testing/capabilities.mjs';
/** @type {Parameters<typeof testCapabilities>[0]} */
const cases = [
  [
    'window-close-provider',
    'src/app/composables/use-app-lifecycle-assembly.ts',
    'src/app/composables/use-window-close-state.ts',
    'provideWindowCloseState',
  ],
  ['window-batch-begin', 'src/app/composables/use-app-lifecycle-assembly.ts', 'src/services/app-lifecycle.service.ts', 'requestClose'],
  [
    'window-batch-release',
    'src/app/composables/use-app-lifecycle-assembly.ts',
    'src/services/app-lifecycle.service.ts',
    'replyNativeClose',
  ],
  ['window-open', 'src/windows/managed.window.ts', 'src/services/window.service.ts', 'requestNativeWindow'],
  ['window-focus', 'src/orchestrators/window-target-focus.orchestrator.ts', 'src/services/window.service.ts', 'focusNativeManagedWindow'],
  ['window-status', 'src/app/composables/use-dirty-window-close-guard.ts', 'src/services/window.service.ts', 'updateNativeWindowStatus'],
  ['window-close-cancel', 'src/app/composables/use-app-lifecycle-assembly.ts', 'src/services/app-lifecycle.service.ts', 'readyNativeClose'],
  ['window-session-close', 'src/app/composables/use-app-lifecycle-assembly.ts', 'src/services/app-lifecycle.service.ts', 'requestClose'],
  [
    'window-reserve',
    'src/orchestrators/spec-editor-identity.orchestrator.ts',
    'src/services/window.service.ts',
    'reserveNativeWindowTargets',
  ],
  ['window-release', 'src/orchestrators/csv-save.orchestrator.ts', 'src/services/window.service.ts', 'releaseNativeWindowTargets'],
  ['window-retarget', 'src/orchestrators/spec-editor-identity.orchestrator.ts', 'src/services/window.service.ts', 'retargetNativeWindow'],
];

testCapabilities(cases);
