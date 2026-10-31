import { testCapabilities } from '../../../testing/capabilities.mjs';
/** @type {Parameters<typeof testCapabilities>[0]} */
const cases = [
  ['log-stopped-listen', 'src/app/application-log.ts', 'src/services/app-log.service.ts', 'listenLogStopped'],
  [
    'settings-changed-listen',
    'src/orchestrators/settings-persistence.orchestrator.ts',
    'src/services/app-settings.service.ts',
    'listenSettingsChanged',
  ],
  [
    'settings-core-source',
    'src/app/composables/settings/use-settings-view-model.ts',
    'src/orchestrators/settings-persistence.orchestrator.ts',
    'saveStarsectorRoot',
  ],
  [
    'settings-close-flush',
    'src/app/composables/use-app-lifecycle-assembly.ts',
    'src/orchestrators/settings-persistence.orchestrator.ts',
    'flushSettings',
  ],
  [
    'system-fonts-read',
    'src/app/composables/settings/use-settings-view-model.ts',
    'src/services/app-settings.service.ts',
    'querySystemFonts',
  ],
];

testCapabilities(cases);
