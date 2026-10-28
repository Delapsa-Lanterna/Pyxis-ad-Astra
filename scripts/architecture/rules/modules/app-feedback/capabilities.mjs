import { capabilities } from '../../capabilities/owners.mjs';

export const applicationCapabilities = [
  ...capabilities({ role: 'orchestrator', domain: 'settings-persistence' }, [
    { capability: 'settings-start', names: ['initializeSettings'], owners: [{ path: 'src/main.ts', layer: 'app' }] },
    {
      capability: 'settings-reset',
      names: ['resetSettings', 'saveStarsectorRoot'],
      owners: [{ layer: 'app', role: 'composable', domain: 'settings-view-model' }],
    },
    {
      capability: 'settings-lifecycle',
      names: ['startSettingsPersistence', 'startSettingsMirror'],
      owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
    },
    {
      capability: 'settings-log-directory',
      names: ['saveLogDirectory'],
      owners: [{ layer: 'app', role: 'composable', domain: 'settings-view-model' }],
    },
    {
      capability: 'settings-close-flush',
      names: ['flushSettings'],
      owners: [{ layer: 'app', role: 'composable', domain: 'app-lifecycle-assembly' }],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'font' }, [
    {
      capability: 'original-font-read',
      names: ['queryOriginalFont'],
      owners: [{ layer: 'app', role: 'composable', domain: 'original-fonts' }],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'app-settings' }, [
    {
      capability: 'settings-read',
      names: ['readSettings', 'readDefaultSettings'],
      owners: [{ layer: 'orchestrators', domain: 'settings-persistence' }],
    },
    {
      capability: 'system-fonts-read',
      names: ['querySystemFonts'],
      owners: [{ path: 'src/app/composables/settings/use-settings-view-model.ts', layer: 'app' }],
    },
    { capability: 'settings-write', names: ['saveSettings'], owners: [{ layer: 'orchestrators', domain: 'settings-persistence' }] },
  ]),
  ...capabilities({ role: 'service', domain: 'app-log' }, [
    {
      capability: 'log-flush',
      names: ['flushApplicationLogs'],
      owners: [{ path: 'src/app/composables/use-app-lifecycle-assembly.ts', layer: 'app' }],
    },
    {
      capability: 'log-record',
      names: ['recordLogBestEffort'],
      owners: [
        { layer: 'services' },
        { layer: 'orchestrators' },
        { layer: 'app', role: 'composable' },
        { layer: 'app', domain: 'app-feedback' },
        { path: 'src/main.ts', layer: 'app' },
      ],
    },
    {
      capability: 'log-maintenance',
      names: ['loadLogStatus', 'clearLog'],
      owners: [
        { layer: 'app', role: 'composable', domain: 'settings-view-model' },
        { path: 'src/app/application-log.ts', layer: 'app' },
      ],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'performance-monitor' }, [
    {
      capability: 'performance-monitor',
      names: ['deliverPerformanceBatch', 'performanceMonitorReport'],
      owners: [{ path: 'src/app/performance-monitor.ts', layer: 'app' }],
    },
  ]),
  ...capabilities({ role: 'service', domain: 'app-config' }, [
    {
      capability: 'config-maintenance',
      names: ['openConfigFolder'],
      owners: [{ layer: 'app', role: 'composable', domain: 'app-config-actions' }],
    },
  ]),
  ...capabilities({ layer: 'app', role: 'module', domain: 'app-feedback' }, [
    { capability: 'feedback-factory', names: ['createAppFeedback'], owners: [{ path: 'src/app/app-feedback-assembly.ts', layer: 'app' }] },
  ]),
  ...capabilities({ path: 'src/app/app-feedback-assembly.ts', layer: 'app', role: 'module', domain: 'app-feedback-assembly' }, [
    {
      capability: 'window-feedback-assembly',
      names: ['createWindowFeedback'],
      owners: [{ path: 'src/app/WindowRuntime.vue', layer: 'app' }],
    },
  ]),
  ...capabilities({ path: 'src/app/composables/use-app-feedback.ts', layer: 'app', role: 'composable', domain: 'app-feedback' }, [
    {
      capability: 'window-feedback-provider',
      names: ['provideAppFeedback'],
      owners: [{ path: 'src/app/WindowRuntime.vue', layer: 'app' }],
    },
    {
      capability: 'window-feedback-consume',
      names: ['useAppFeedback'],
      owners: [
        { layer: 'app', role: 'composable' },
        { layer: 'app', role: 'component' },
      ],
    },
  ]),
  ...capabilities({ role: 'external', domain: 'naive-ui' }, [
    {
      capability: 'feedback-runtime',
      names: ['useMessage', 'useDialog', 'createDiscreteApi'],
      owners: [{ path: 'src/app/WindowRuntime.vue', layer: 'app' }],
    },
  ]),
  ...capabilities({ role: 'external', domain: 'naive-ui/es/message' }, [
    {
      capability: 'feedback-runtime',
      names: ['useMessage', 'useDialog', 'createDiscreteApi'],
      owners: [{ path: 'src/app/WindowRuntime.vue', layer: 'app' }],
    },
  ]),
  ...capabilities({ role: 'external', domain: 'naive-ui/es/dialog' }, [
    {
      capability: 'feedback-runtime',
      names: ['useMessage', 'useDialog', 'createDiscreteApi'],
      owners: [{ path: 'src/app/WindowRuntime.vue', layer: 'app' }],
    },
  ]),
  ...capabilities({ role: 'external', domain: 'naive-ui/es/discrete' }, [
    {
      capability: 'feedback-runtime',
      names: ['useMessage', 'useDialog', 'createDiscreteApi'],
      owners: [{ path: 'src/app/WindowRuntime.vue', layer: 'app' }],
    },
  ]),
];
