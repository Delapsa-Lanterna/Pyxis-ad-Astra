import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { installCanvas2DStub } from '@/test/canvas-stub';
import { variantJointFixture } from '@/test/variant-joint-edit';
import { projectVariantPanel } from '@/domain/immersive/variant-panel';
import VariantScene from './VariantScene.vue';

vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn(), warning: vi.fn() }) }));
vi.mock('@/app/composables/use-resource-media-registry', () => ({
  useResourceMediaRegistry: () => ({ replaceCollection: vi.fn(), dataUrl: () => '' }),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('variant scene pointer dismissal', () => {
  it('distinguishes a blank left click from a weapon hit and right-button navigation', async () => {
    installCanvas2DStub();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 700,
      width: 1000,
      height: 700,
      toJSON: () => ({}),
    });
    const snapshot = variantJointFixture();
    const values = Object.fromEntries(snapshot.records.map((record) => [record.key, record.value]));
    const own = mount(VariantScene, {
      props: { variant: projectVariantPanel(snapshot, values).variants[0]!, sessionId: 's' },
      global: { stubs: { ImmersiveText: true } },
    });
    const canvas = own.find('canvas');
    await canvas.trigger('mousedown', { button: 0, clientX: 390, clientY: 350 });
    expect(own.emitted('slot')).toEqual([[0, { x: 390, y: 350 }]]);
    expect(own.emitted('blank')).toBeUndefined();
    await canvas.trigger('mousedown', { button: 2, clientX: 20, clientY: 20 });
    await canvas.trigger('mousemove', { clientX: 25, clientY: 25 });
    await canvas.trigger('mouseup', { button: 2 });
    expect(own.emitted('blank')).toBeUndefined();
    await canvas.trigger('mousedown', { button: 0, clientX: 20, clientY: 20 });
    expect(own.emitted('blank')).toEqual([[]]);
    expect(own.emitted('slot')).toHaveLength(1);
    own.unmount();
  });
});
