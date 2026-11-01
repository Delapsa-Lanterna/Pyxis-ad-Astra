import { capabilities } from './owners.mjs';

export const eventCapabilities = [
  ...capabilities({ path: 'src/shared/runtime/event.runtime.ts', layer: 'shared', role: 'shared', domain: 'runtime' }, [
    {
      capability: 'app-event-listen',
      names: ['listenAppEvent'],
      owners: [
        { path: 'src/services/app-log.service.ts', layer: 'services' },
        { path: 'src/services/app-settings.service.ts', layer: 'services' },
        { path: 'src/windows/window-context.window.ts', layer: 'windows' },
        { path: 'src/app/composables/use-app-close-participant.ts', layer: 'app' },
      ],
    },
  ]),
  ...capabilities({ role: 'external', domain: '@tauri-apps/api/event' }, [
    {
      capability: 'event-wire',
      names: ['listen'],
      owners: [{ path: 'src/shared/runtime/event.runtime.ts', layer: 'shared', domain: 'runtime' }],
    },
  ]),
];
