import { mount, flushPromises } from '@vue/test-utils';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent } from 'vue';
import { shipJointFixture, jointFixtureValues } from '@/test/joint-edit';
import { projectShipPanel } from '@/domain/immersive/ship-panel';
import ImmersiveStatRow from './ImmersiveStatRow.vue';
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});
function harness() {
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
    props: { stat, snapshot, values, editable: true, active: true, runtimeContext: { sessionId: 's', modRoot: 'M:/mod' } },
    global: {
      stubs: {
        ImmersiveText: true,
        NPopover: defineComponent({
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
