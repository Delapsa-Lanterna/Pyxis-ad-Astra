import type { BrowserLocation } from './location';

export interface BrowserLocationClient {
  open(location: BrowserLocation): Promise<void>;
  read(): BrowserLocation | null;
}
export function createLocationChannel() {
  const clients = new Map<string, BrowserLocationClient>();
  let receive: (label: string, location: BrowserLocation, focused: boolean) => void = () => {};
  function release(label: string) {
    clients.delete(label);
    if (label !== 'main') {
      const location = clients.get('main')?.read();
      if (location) receive('main', location, true);
    }
  }
  return {
    clients,
    release,
    listen(callback: typeof receive) {
      receive = callback;
      return () => {
        receive = () => {};
      };
    },
    connect(label: string, client: BrowserLocationClient) {
      clients.set(label, client);
      return () => release(label);
    },
    publish(label: string, location: BrowserLocation, focused = false) {
      receive(label, location, focused);
    },
  };
}
