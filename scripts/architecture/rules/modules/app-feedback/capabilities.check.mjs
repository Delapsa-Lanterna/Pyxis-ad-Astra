import { testCapabilities } from '../../../testing/capabilities.mjs';
const cases = [
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
