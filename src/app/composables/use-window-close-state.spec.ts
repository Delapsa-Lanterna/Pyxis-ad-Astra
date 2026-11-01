import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, expect, it, vi } from 'vitest';
import { h, onMounted, onUnmounted, ref } from 'vue';
import {
  provideWindowCloseState,
  useWindowCloseParticipant,
  useWindowCloseRequest,
  useWindowCloseState,
  type WindowCloseParticipantOptions,
} from './use-window-close-state';

let wrapper: ReturnType<typeof mount>;
afterEach(() => wrapper?.unmount());
it('registers a participant in the content scope and releases it before content cleanup', async () => {
  const order: string[] = [];
  const install = vi.fn(async () => {
    order.push('installed');
  });
  const dispose = vi.fn(() => {
    order.push('released');
  });
  const requestClose = vi.fn(async () => ({ status: 'closed' as const, destroyedWindows: [], releasedSessions: [], diagnostic: null }));
  const factory = vi.fn((options: WindowCloseParticipantOptions) => {
    expect(options.dirty).toBe(dirty);
    expect(useWindowCloseState()!.value).toBe(false);
    order.push('created');
    return { install, dispose, requestClose: async () => true };
  });
  const dirty = ref(false);
  const Content = {
    setup() {
      expect(useWindowCloseRequest()).toBe(requestClose);
      const participant = useWindowCloseParticipant({ dirty, title: 'Close fixture', content: 'Fixture content' });
      onMounted(participant.install);
      onUnmounted(() => {
        order.push('content');
      });
      return () => h('button', { onClick: participant.requestClose }, 'Close');
    },
  };
  wrapper = mount({
    setup() {
      provideWindowCloseState({ requestClose, createParticipant: factory });
      return () => h(Content);
    },
  });
  await flushPromises();
  expect(factory).toHaveBeenCalledOnce();
  expect(factory.mock.calls[0]![0].dirty).toBe(dirty);
  expect(order).toEqual(['created', 'installed']);
  wrapper.unmount();
  expect(dispose).toHaveBeenCalledOnce();
  expect(order).toEqual(['created', 'installed', 'released', 'content']);
});
