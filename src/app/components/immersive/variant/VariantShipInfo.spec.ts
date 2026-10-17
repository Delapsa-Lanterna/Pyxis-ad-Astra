import { describe, expect, it, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { variantJointFixture } from '@/test/variant-joint-edit';
import { projectVariantPanel } from '@/domain/immersive/variant/variant-panel';
import { jointObject } from '@/domain/joint-edit';
import VariantShipInfo from './VariantShipInfo.vue';

const media = vi.hoisted(() => ({ replaceCollection: vi.fn(async () => {}), dataUrl: vi.fn(() => 'sprite-data') }));
vi.mock('@/app/composables/use-resource-media-registry', () => ({ useResourceMediaRegistry: () => media }));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn(), warning: vi.fn() }) }));
describe('Variant ship read-only source and media ownership', () => {
  it('projects draft changes into a stable display and releases its media on close and target replacement', async () => {
    media.replaceCollection.mockClear();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    const snapshot = variantJointFixture();
    snapshot.hull!.sprite = { source: 'core', relPath: 'aurora.png', ownerKind: 'ship', ownerId: 'aurora', key: 'sprite' };
    const values = Object.fromEntries(snapshot.records.map((record) => [record.key, structuredClone(record.value)]));
    const own = mount(VariantShipInfo, {
      props: { snapshot, values, root: snapshot.root, variant: projectVariantPanel(snapshot, values).variants[0]! },
      global: {
        stubs: {
          ImmersiveText: { props: ['text'], template: '<span>{{text}}</span>' },
          ShipImmersivePanel: {
            props: ['panel', 'render'],
            template:
              '<article>{{panel.heading[0].display}} {{panel.combat.find(stat => stat.id === "max flux").display}} {{render.mode}}</article>',
          },
        },
      },
    });
    expect(media.replaceCollection).toHaveBeenCalledWith('s', 'ship-info-button', []);
    const button = own.find('button').element;
    const graphic = own.find('.immersive-resource-icon').element;
    expect(own.find('.immersive-resource-icon').attributes('style')).toContain('data:image/svg+xml');
    const resource = {
      source: 'core' as const,
      ownerKind: 'ship' as const,
      ownerId: 'refit-ui',
      key: 'icon_more_info',
      relPath: 'info.png',
    };
    await own.setProps({
      snapshot: { ...snapshot, referenceSettings: { ...snapshot.referenceSettings, resources: { icon_more_info: resource } } },
    });
    expect(media.replaceCollection).toHaveBeenLastCalledWith('s', 'ship-info-button', [resource]);
    expect(own.find('.immersive-resource-icon').exists()).toBe(true);
    expect(own.find('.immersive-resource-icon').element).toBe(graphic);
    await own.setProps({ snapshot });
    expect(own.find('button').element).toBe(button);
    expect(own.find('.immersive-resource-icon').attributes('style')).toContain('data:image/svg+xml');
    await own.find('button').trigger('focus');
    await flushPromises();
    const node = own.find('article').element;
    expect(own.find('article').text()).toBe('Aurora · Assault 11800 readonly');
    expect(media.replaceCollection).toHaveBeenLastCalledWith('s', 'ship-info', [snapshot.hull!.sprite]);
    values.variant = { state: 'present', value: { ...jointObject(values.variant), fluxCapacitors: 7 } };
    await own.setProps({ values, variant: projectVariantPanel(snapshot, values).variants[0]! });
    expect(own.find('article').element).toBe(node);
    expect(own.find('article').text()).toContain('12400');
    await own.find('[role=dialog]').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(own.find('article').exists()).toBe(false);
    expect(media.replaceCollection).toHaveBeenLastCalledWith('s', 'ship-info', []);
    await own.find('button').trigger('click');
    await flushPromises();
    await own.setProps({ variant: { ...projectVariantPanel(snapshot, values).variants[0]!, key: 'module' } });
    await flushPromises();
    expect(own.find('article').exists()).toBe(false);
    expect(media.replaceCollection).toHaveBeenLastCalledWith('s', 'ship-info', []);
    own.unmount();
    vi.unstubAllGlobals();
  });
});
