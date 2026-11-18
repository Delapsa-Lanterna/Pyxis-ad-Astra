import type { BrowserWorkspace } from './workspace-runtime';
import { browserBase, locationHref, readBrowserLocation } from './location';
import type { BrowserLocation } from './location';
import { until } from './timing';

export function showLocationError(error: unknown) {
  let notice = document.querySelector<HTMLElement>('#browser-location-error');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'browser-location-error';
    notice.className = 'ui-notice';
    notice.setAttribute('role', 'alert');
    document.body.prepend(notice);
  }
  notice.replaceChildren();
  const message = document.createElement('span');
  message.textContent = error instanceof Error ? error.message : String(error);
  const link = document.createElement('a');
  link.href = browserBase();
  link.textContent = '返回工作区';
  notice.append(message, document.createTextNode(' '), link);
}
export function startBrowserRouting(workspace: BrowserWorkspace, initial: BrowserLocation) {
  let applying = false,
    sequence = Promise.resolve(),
    active = 'main';
  const channel = workspace.locations;
  function href(location: BrowserLocation) {
    const target =
      initial.sampleWindow && initial.mod === location.mod && initial.view === location.view
        ? { ...location, sampleWindow: initial.sampleWindow }
        : location;
    return locationHref(target, browserBase());
  }
  function publish(label: string, location: BrowserLocation, focused = false) {
    if (applying || (label !== active && !focused)) return;
    active = label;
    const target = href(location);
    if (target === window.location.pathname + window.location.search) return;
    history.pushState(null, '', target);
  }
  const stop = channel.listen(publish);
  async function apply(location: BrowserLocation) {
    applying = true;
    try {
      document.querySelector('#browser-location-error')?.remove();
      await until(() => channel.clients.has('main'), '工作区链接入口');
      await channel.clients.get('main')!.open(location);
      const entries = [...channel.clients];
      const child = entries.find(
        ([label, client]) =>
          label !== 'main' && (['view', 'mod', 'kind', 'id', 'path'] as const).every((key) => client.read()?.[key] === location[key]),
      );
      active = child?.[0] ?? 'main';
      document.querySelector<HTMLIFrameElement>('iframe[data-window="' + active + '"]')?.scrollIntoView({ block: 'nearest' });
      history.replaceState(null, '', href(location));
      document.body.dataset.locationReady = 'true';
    } finally {
      applying = false;
    }
  }
  function navigate(location: BrowserLocation) {
    delete document.body.dataset.locationReady;
    sequence = sequence.then(() => apply(location)).catch(showLocationError);
    return sequence;
  }
  function pop() {
    try {
      const location = readBrowserLocation(window.location.search);
      if (location.view === 'scene' || location.view === 'testbed') window.location.reload();
      else void navigate(location);
    } catch (error) {
      showLocationError(error);
    }
  }
  window.addEventListener('popstate', pop);
  void navigate(initial);
  return {
    dispose() {
      stop();
      window.removeEventListener('popstate', pop);
    },
    focus(label: string) {
      const location = channel.clients.get(label)?.read();
      if (location) {
        active = label;
        publish(label, location, true);
      }
    },
  };
}
