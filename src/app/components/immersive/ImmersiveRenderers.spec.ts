import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { h, shallowRef, nextTick } from 'vue';
import { shipJointFixture } from '@/test/joint-edit';
import { weaponJointFixture } from '@/test/weapon-joint-edit';
import { wingJointFixture } from '@/test/wing-joint-edit';
import { projectShipPanel } from '@/domain/immersive/ship-panel';
import { projectWeaponPanel } from '@/domain/immersive/weapon-panel';
import { projectWingPanel } from '@/domain/immersive/wing-panel';
import type { ImmersiveEditing, ImmersiveRenderContext } from './immersive-render-context';
import ShipImmersivePanel from './ShipImmersivePanel.vue';
import WeaponImmersivePanel from './WeaponImmersivePanel.vue';
import WingImmersivePanel from './WingImmersivePanel.vue';

describe('shared immersive content renderers', () => {
  it.each(['ship', 'weapon', 'wing'] as const)('renders the same %s content and media in either mode', async (kind) => {
    const snapshot = kind === 'ship' ? shipJointFixture() : kind === 'weapon' ? weaponJointFixture() : wingJointFixture();
    const values = Object.fromEntries(snapshot.records.map((record) => [record.key, record.value]));
    const editing: ImmersiveEditing = {
      snapshot,
      values,
      runtimeContext: { sessionId: 's', modRoot: 'M:/mod' },
      activeStat: null,
      changing: false,
      saving: false,
      notices: [],
      editable: () => true,
      toggle: vi.fn(async () => {}),
      dismiss: vi.fn(),
      update: vi.fn(),
      override: vi.fn(async () => {}),
      create: vi.fn(async () => {}),
      openProjectile: vi.fn(async () => {}),
    };
    const common = { root: snapshot.root, records: snapshot.records, mediaUrl: () => 'data:image/png;base64,fixture' };
    const render = shallowRef<ImmersiveRenderContext>({ ...common, mode: 'editable', editing });
    const panel =
      kind === 'ship'
        ? projectShipPanel(snapshot, values)
        : kind === 'weapon'
          ? projectWeaponPanel(snapshot, values)
          : projectWingPanel(snapshot, values);
    const contentRenderer = () =>
      panel.kind === 'ship'
        ? h(ShipImmersivePanel, { panel, render: render.value })
        : panel.kind === 'weapon'
          ? h(WeaponImmersivePanel, { panel, render: render.value })
          : h(WingImmersivePanel, { panel, render: render.value });
    const own = mount(
      { setup: () => contentRenderer },
      {
        global: {
          stubs: {
            ImmersiveText: { props: ['text', 'runs'], template: '<span>{{text || runs?.map(run => run.text).join("")}}</span>' },
            ImmersiveHighlightedText: { props: ['text'], template: '<span>{{text}}</span>' },
            ImmersiveShipPreview: { props: ['url', 'label'], template: '<img :src="url" :alt="label" />' },
            ImmersiveWeaponIcon: { props: ['url', 'label'], template: '<img :src="url(null)" :alt="label" />' },
            ImmersiveFieldPopover: true,
            NPopover: { template: '<div><slot name="trigger" /></div>' },
            NButton: { template: '<button><slot /></button>' },
          },
        },
      },
    );
    const content = () =>
      own
        .findAll('.immersive-stat-row')
        .filter((row) => !row.text().includes('显示设置'))
        .map((row) => row.text());
    const editableContent = content();
    const images = own.findAll('img').map((image) => image.attributes('src'));
    const firstButton = own.find('.immersive-stat-value');
    await firstButton.trigger('click');
    expect(editing.toggle).toHaveBeenCalledWith(panel.heading[0]!.id, true);
    render.value = { ...common, mode: 'readonly' };
    await nextTick();
    expect(content()).toEqual(editableContent);
    expect(own.findAll('img').map((image) => image.attributes('src'))).toEqual(images);
    expect(own.findAll('button')).toHaveLength(0);
    expect(own.findAll('input')).toHaveLength(0);
    expect(own.findAll('.immersive-stat-value').every((value) => value.element.tagName === 'STRONG')).toBe(true);
    expect(own.find('.immersive-readonly-sources').exists()).toBe(true);
    own.unmount();
  });
});
