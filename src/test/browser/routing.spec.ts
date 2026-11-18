import { expect, it, vi } from 'vitest';
import { createLocationChannel } from './location-channel';
import { startBrowserRouting } from './routing';
import type { BrowserLocation } from './location';

const settled = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
it('synchronizes a selected page and restores it through browser history', async () => {
  history.replaceState(null, '', '/');
  const locations = createLocationChannel();
  let current: BrowserLocation = { view: 'workspace' };
  const open = vi.fn(async (location: BrowserLocation) => {
    current = location;
  });
  locations.connect('main', { open, read: () => current });
  const workspace = { locations };
  const routing = startBrowserRouting(workspace as Parameters<typeof startBrowserRouting>[0], current);
  try {
    await settled();
    locations.publish('main', { view: 'settings' }, true);
    expect(window.location.search).toBe('?view=settings');
    history.replaceState(null, '', '/?view=about');
    window.dispatchEvent(new PopStateEvent('popstate'));
    await settled();
    expect(open).toHaveBeenLastCalledWith({ view: 'about' });
    expect(current).toEqual({ view: 'about' });
    expect(document.body.dataset.locationReady).toBe('true');
  } finally {
    routing.dispose();
    history.replaceState(null, '', '/');
  }
});
it('keeps the focused child location while background main state changes and restores the main location on close', async () => {
  history.replaceState(null, '', '/');
  const locations = createLocationChannel();
  const main: BrowserLocation = { view: 'workspace' };
  const child: BrowserLocation = { view: 'immersive', mod: 'fixture_mod', kind: 'ship', id: 'fixture_ship' };
  locations.connect('main', { open: async () => {}, read: () => main });
  const routing = startBrowserRouting({ locations } as Parameters<typeof startBrowserRouting>[0], main);
  try {
    await settled();
    const close = locations.connect('child', { open: async () => {}, read: () => child });
    locations.publish('child', child, true);
    locations.publish('main', { view: 'settings' });
    expect(window.location.search).toContain('id=fixture_ship');
    close();
    expect(window.location.search).toBe('');
  } finally {
    routing.dispose();
    history.replaceState(null, '', '/');
  }
});
it('shows a readable link error and keeps a return link to the deployment base', async () => {
  history.replaceState(null, '', '/project/?view=about');
  const locations = createLocationChannel();
  locations.connect('main', {
    open: async () => {
      throw Error('Fixture target does not exist');
    },
    read: () => null,
  });
  const routing = startBrowserRouting({ locations } as Parameters<typeof startBrowserRouting>[0], { view: 'about' });
  try {
    await settled();
    expect(document.querySelector('#browser-location-error')!.textContent).toContain('Fixture target does not exist');
    expect(document.querySelector<HTMLAnchorElement>('#browser-location-error a')!.getAttribute('href')).toBe('/project/');
  } finally {
    routing.dispose();
    document.querySelector('#browser-location-error')?.remove();
    history.replaceState(null, '', '/');
  }
});
