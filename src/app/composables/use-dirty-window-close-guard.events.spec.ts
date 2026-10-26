import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia } from 'pinia';
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils';
import { h, onUnmounted, ref, type Ref } from 'vue';
import { emitTo, type EventTarget } from '@tauri-apps/api/event';
import { clearMocks, mockIPC, mockWindows } from '@tauri-apps/api/mocks';
import type { WindowCloseIntent } from '@/shared/types';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { provideWindowCloseState } from './use-window-close-state';
import { useDirtyWindowCloseGuard } from './use-dirty-window-close-guard';
import { WINDOW_EVENTS } from '@/windows/window.events';
import { listenWindowEvent } from '@/windows/tauri.events';

vi.mock('@/services/window.service', () => ({ updateNativeWindowStatus: vi.fn(async () => {}) }));
vi.mock('@/windows/window-context.window', () => ({ settleWindowRequests: async () => {} }));
vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({ choose: vi.fn(async () => 'discard'), error: vi.fn() }),
}));

interface Subscription {
  event: string;
  target: EventTarget;
  handler: number;
}
const listeners = new Map<number, Subscription>();
const wrappers: VueWrapper[] = [];

beforeEach(() => {
  listeners.clear();
  mockIPC((command, payload) => {
    if (command === 'plugin:event|listen') {
      const subscription = payload as unknown as Subscription;
      listeners.set(subscription.handler, subscription);
      return subscription.handler;
    }
    if (command === 'plugin:event|unlisten') {
      listeners.delete((payload as { eventId: number }).eventId);
    }
    if (command === 'plugin:event|emit_to') {
      const message = payload as { event: string; target: { label: string }; payload: WindowCloseIntent };
      const runtime = Reflect.get(window, '__TAURI_INTERNALS__') as { runCallback: (id: number, data: unknown) => void };
      for (const subscription of listeners.values()) {
        const target = subscription.target;
        if (
          subscription.event === message.event &&
          (target.kind === 'Any' || ('label' in target && target.label === message.target.label))
        ) {
          runtime.runCallback(subscription.handler, { event: message.event, id: subscription.handler, payload: message.payload });
        }
      }
    }
  });
});
afterEach(async () => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  await flushPromises();
  clearMocks();
});

async function openWindow(label: string) {
  mockWindows(label);
  const pinia = createPinia();
  const commands = useSaveCommandStore(pinia);
  let closing!: Ref<boolean>;
  let guard!: ReturnType<typeof useDirtyWindowCloseGuard>;
  const reply = vi.fn(async () => {});
  const Contents = {
    setup() {
      guard = useDirtyWindowCloseGuard({ dirty: ref(false), title: 'Close fixture', content: 'Close fixture' });
      onUnmounted(guard.dispose);
      return () => h('button', 'Edit');
    },
  };
  const wrapper = mount(
    {
      setup() {
        closing = provideWindowCloseState({
          replyClose: reply,
          readyClose: async () => {},
          acceptReleasedSessions: () => {},
          requestClose: async () => ({ status: 'closed', destroyedWindows: [], releasedSessions: [], diagnostic: null }),
          prepareDisplay: () => async () => {},
          flushSettings: async () => {},
        });
        return () => h('main', { inert: closing.value || undefined }, h(Contents));
      },
    },
    { global: { plugins: [pinia] } },
  );
  wrappers.push(wrapper);
  await guard.install();
  return { wrapper, closing, commands, reply };
}

async function phase(label: string, step: WindowCloseIntent['phase'], operationId = 1) {
  await emitTo(label, WINDOW_EVENTS.windowCloseIntent, {
    operationId,
    phase: step,
    onlyIfClean: false,
    scope: { kind: 'window' },
    releasedSessions: [],
  });
  await flushPromises();
}

describe('window close event isolation', () => {
  it.each(['immersive', 'spec', 'file', 'preview'])('keeps surviving windows interactive after closing a clean %s window', async (kind) => {
    const broadcast = vi.fn();
    const stopBroadcast = await listenWindowEvent<WindowCloseIntent>(WINDOW_EVENTS.windowCloseIntent, broadcast, vi.fn());
    const main = await openWindow('main');
    const peer = await openWindow('peer-fixture');
    const label = `${kind}-fixture`;
    const child = await openWindow(label);
    for (const step of ['hold', 'settle', 'prepare', 'confirm'] as const) await phase(label, step);
    expect(child.closing.value).toBe(true);
    expect(child.commands.closePrepared).toBe(true);
    expect(main.closing.value).toBe(false);
    expect(peer.closing.value).toBe(false);
    expect(main.reply).not.toHaveBeenCalled();
    expect(peer.reply).not.toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledTimes(4);
    await stopBroadcast();
    child.wrapper.unmount();
    await flushPromises();
    expect(main.wrapper.attributes('inert')).toBeUndefined();
    expect(peer.wrapper.attributes('inert')).toBeUndefined();
    expect(main.commands.closePrepared).toBe(false);
    expect(peer.commands.closePrepared).toBe(false);
    for (const step of ['hold', 'prepare', 'resume'] as const) await phase('main', step, 2);
    expect(main.closing.value).toBe(false);
    expect(main.commands.closePrepared).toBe(false);
    expect(main.reply).toHaveBeenLastCalledWith(2, 'resume', true, null);
    expect(peer.reply).not.toHaveBeenCalled();
  });
});
