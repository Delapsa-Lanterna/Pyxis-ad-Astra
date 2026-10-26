import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref } from 'vue';
import { expect, it, vi } from 'vitest';
import { createFieldInputs } from '@/shared/runtime/field-inputs';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useEditTargetHandoff } from './use-edit-target-handoff';

const api = vi.hoisted(() => ({ update: vi.fn() }));
vi.mock('@/services/window.service', () => ({ updateEditTargetRegistration: api.update }));
vi.mock('@/orchestrators/edit-target-handoff.orchestrator', () => ({ listenEditTargetHandoff: async () => () => {} }));

it('settles registrations before close and publishes the surviving targets after cleanup', async () => {
  setActivePinia(createPinia());
  const commands = useSaveCommandStore();
  const target = { sessionId: 'fixture', modRoot: 'M:/fixture', path: 'M:/fixture/file.json' };
  const unregister = commands.registerSaveSession({
    targetKey: ref('fixture'),
    modRoot: ref(target.modRoot),
    saving: ref(false),
    waitForSave: async () => true,
    editing: {
      targets: ref([target]),
      label: 'Fixture',
      dirty: ref(false),
      draftSession: { draftValue: ref({}), inputs: createFieldInputs() },
      save: async () => ({ status: 'noop' }),
    },
  });
  let finish!: () => void;
  api.update.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const feedback = {
    error: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  };
  const wrapper = mount({
    setup() {
      useEditTargetHandoff(feedback);
      return () => null;
    },
  });
  await flushPromises();
  expect(api.update).toHaveBeenCalledExactlyOnceWith([target]);
  let settled = false;
  const waiting = commands.settleCloseActions().then(() => {
    settled = true;
  });
  await flushPromises();
  expect(settled).toBe(false);
  finish();
  await waiting;
  commands.closePrepared = true;
  await nextTick();
  unregister();
  await nextTick();
  expect(api.update).toHaveBeenCalledTimes(1);
  commands.closePrepared = false;
  await flushPromises();
  expect(api.update).toHaveBeenLastCalledWith([]);
  finish();
  await commands.settleCloseActions();
  expect(feedback.error).not.toHaveBeenCalled();
  api.update.mockResolvedValue(undefined);
  wrapper.unmount();
  await flushPromises();
});
