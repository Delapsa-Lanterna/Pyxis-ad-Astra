import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent } from 'vue';
import { shipJointFixture, jointFixtureValues } from '@/test/joint-edit';
import { projectShipPanel } from '@/domain/immersive/ship/ship-panel';
import ImmersiveStatRow from './ImmersiveStatRow.vue';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});
function harness(attachTo?: HTMLElement) {
  const scroll = vi.fn(),
    sync = vi.fn();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(0));
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: scroll, configurable: true });
  const snapshot = shipJointFixture(),
    values = jointFixtureValues(snapshot),
    stat = projectShipPanel(snapshot, values).combat[0]!;
  const own = mount(ImmersiveStatRow, {
    attachTo,
    props: { stat, snapshot, values, editable: true, active: true, runtimeContext: { sessionId: 's', modRoot: 'M:/mod' } },
    global: {
      stubs: {
        ImmersiveText: true,
        NPopover: defineComponent({
          name: 'NPopover',
          props: { to: { type: HTMLElement, default: undefined } },
          setup(_props, { expose }) {
            expose({ syncPosition: sync });
          },
          template: '<div><slot name="trigger" /></div>',
        }),
      },
    },
  });
  return { own, scroll, sync };
}
describe('immersive popover anchor resizing', () => {
  it('keeps field inputs within their active dialog focus boundary', async () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.append(dialog);
    const state = harness(dialog);
    await flushPromises();
    expect(state.own.findComponent({ name: 'NPopover' }).props('to')).toBe(dialog);
    state.own.unmount();
    dialog.remove();
  });
  it('submits one explicit trigger intent', async () => {
    const state = harness();
    await state.own.find('button').trigger('click');
    expect(state.own.emitted('toggle')).toEqual([[false]]);
    state.own.unmount();
  });
  it('keeps the same trigger node and reveals its anchor before resynchronizing the popover', async () => {
    const state = harness(),
      trigger = state.own.find('button').element;
    window.dispatchEvent(new Event('resize'));
    await flushPromises();
    expect(state.scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    expect(state.sync).toHaveBeenCalledOnce();
    expect(state.own.find('button').element).toBe(trigger);
    state.own.unmount();
  });
  it('releases resize admission when the popover closes or unmounts', async () => {
    const state = harness();
    await state.own.setProps({ active: false });
    window.dispatchEvent(new Event('resize'));
    await flushPromises();
    expect(state.scroll).not.toHaveBeenCalled();
    state.own.unmount();
    window.dispatchEvent(new Event('resize'));
    await flushPromises();
    expect(state.sync).not.toHaveBeenCalled();
  });
});
