import { describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { h, shallowRef, nextTick } from 'vue';
import { shipJointFixture } from '@/test/joint-edit';
import { weaponJointFixture } from '@/test/weapon-joint-edit';
import { wingJointFixture } from '@/test/wing-joint-edit';
import { projectShipPanel } from '@/domain/immersive/ship/ship-panel';
import { projectWeaponPanel } from '@/domain/immersive/weapon/weapon-panel';
import { jointObject } from '@/domain/joint-edit';
import { projectWingPanel } from '@/domain/immersive/wing/wing-panel';
import type { ImmersiveEditing, ImmersiveRenderContext } from './immersive-render-context';
import ShipImmersivePanel from './ship/ShipImmersivePanel.vue';
import WeaponImmersivePanel from './weapon/WeaponImmersivePanel.vue';
import WingImmersivePanel from './wing/WingImmersivePanel.vue';

describe('shared immersive content renderers', () => {
  it.each(['KINETIC', 'HIGH_EXPLOSIVE', 'FRAGMENTATION', 'ENERGY', 'OTHER'])(
    'switches %s damage display from a local graphic to its source',
    async (type) => {
      const snapshot = weaponJointFixture();
      const values = Object.fromEntries(snapshot.records.map((record) => [record.key, record.value]));
      values.csv = { state: 'present', value: { ...jointObject(values.csv), type } };
      const panel = projectWeaponPanel(snapshot, values);
      const render: ImmersiveRenderContext = { mode: 'readonly', root: snapshot.root, records: snapshot.records, mediaUrl: () => '' };
      const own = mount(WeaponImmersivePanel, {
        props: { panel, render },
        global: {
          stubs: {
            ImmersivePanelRow: true,
            ImmersivePanelSources: true,
            ImmersiveSection: true,
            ImmersiveWeaponIcon: true,
            ImmersiveText: true,
            NButton: true,
          },
        },
      });
      expect(panel.damageType).toBe(type);
      expect(own.find('img[alt="伤害类型图标"]').attributes('width')).toBe('80');
      await own.setProps({ render: { ...render, mediaUrl: () => 'damage.png' } });
      expect(own.find('img.immersive-damage-icon').attributes('src')).toBe('damage.png');
      own.unmount();
    },
  );
  it.each(['ship', 'weapon', 'wing'] as const)('shares %s technical content while applying the readonly summary', async (kind) => {
    const snapshot = kind === 'ship' ? shipJointFixture() : kind === 'weapon' ? weaponJointFixture() : wingJointFixture();
    const values = Object.fromEntries(snapshot.records.map((record) => [record.key, record.value]));
    if (kind === 'weapon')
      values.csv = {
        state: 'present',
        value: {
          ...jointObject(values.csv),
          customPrimary: 'Burst %s',
          customPrimaryHL: '25%',
          customAncillary: '%s beams',
          customAncillaryHL: '2 {x}',
        },
      };
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
    };
    const common = { root: snapshot.root, records: snapshot.records, mediaUrl: () => 'data:image/png;base64,fixture' };
    const render = shallowRef<ImmersiveRenderContext>({ ...common, mode: 'editable', editing });
    const panel =
      kind === 'ship'
        ? projectShipPanel(snapshot, values)
        : kind === 'weapon'
          ? projectWeaponPanel(snapshot, values)
          : projectWingPanel(snapshot, values);
    panel.description.display = '第一自然段 first line.\r\nContinuation in the same paragraph.\r\n \t\r\n第二自然段。\r\n\r\n第三自然段。';
    const completeDescription = panel.description.display;
    if (panel.kind === 'ship') panel.notes = ['顶部说明'];
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
            ImmersiveShipPreview: { props: ['url', 'label'], template: '<img :src="url" :alt="label" />' },
            ImmersiveHullScene: { name: 'ImmersiveHullScene', props: ['variant', 'wingLayout', 'iconSize'], template: '<canvas />' },
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
        .filter(
          (row) =>
            !row.text().includes('显示设置') &&
            !row.element.closest('.ship-immersive-description') &&
            (kind !== 'ship' || !row.element.closest('.ship-immersive-header')),
        )
        .map((row) => row.text());
    const editableContent = content();
    const customText = () => own.findAll('.immersive-custom-text').map((row) => row.text());
    if (kind === 'weapon') expect(customText()).toEqual(['Burst 25%', '2 × beams']);
    const images = own.findAll('img').map((image) => image.attributes('src'));
    const formation = panel.kind === 'wing' ? own.findComponent({ name: 'ImmersiveHullScene' }) : null;
    if (formation) {
      expect(formation.props('wingLayout').points).toHaveLength(3);
      expect(formation.props('wingLayout').points[0].y).toBeCloseTo(13.2);
      expect(formation.props('iconSize')).toBe(80);
      expect(formation.props('variant').spec.hullId).toBe('sarissa');
    }
    if (kind === 'weapon') {
      const weapon = own.findComponent(WeaponImmersivePanel);
      await weapon
        .findAll('button')
        .find((button) => button.text() === '弹体编辑器')!
        .trigger('click');
      expect(weapon.emitted('open-projectile')).toEqual([[]]);
    }
    const firstButton = own.find('.immersive-stat-value');
    await firstButton.trigger('click');
    expect(editing.toggle).toHaveBeenCalledWith(panel.heading[0]!.id, true);
    expect(own.find('.ship-immersive-description').text()).toContain(completeDescription);
    if (kind === 'ship') {
      expect(own.find('.ship-immersive-header').exists()).toBe(true);
      expect(own.find('.immersive-source-note').text()).toBe('顶部说明');
    }
    render.value = { ...common, mode: 'readonly' };
    await nextTick();
    expect(content()).toEqual(editableContent);
    if (kind === 'weapon') expect(customText()).toEqual(['Burst 25%', '2 × beams']);
    if (formation) expect(own.findComponent({ name: 'ImmersiveHullScene' }).element).toBe(formation.element);
    if (kind === 'ship') {
      expect(own.find('.ship-immersive-header').exists()).toBe(false);
      expect(own.findAll('.immersive-source-note')).toHaveLength(0);
      expect(own.findAll('img')).toHaveLength(0);
      expect(own.find('h2').text()).toBe('后勤数据');
    } else {
      expect(own.findAll('img').map((image) => image.attributes('src'))).toEqual(images);
      expect(own.find('.ship-immersive-description .immersive-stat-value').text()).toBe(
        '第一自然段 first line.\r\nContinuation in the same paragraph.',
      );
    }
    expect(panel.description.display).toBe(completeDescription);
    expect(own.findAll('button')).toHaveLength(0);
    expect(own.findAll('.immersive-stat-value').every((value) => value.element.tagName === 'STRONG')).toBe(true);
    render.value = { ...common, mode: 'editable', editing };
    await nextTick();
    expect(own.find('.ship-immersive-description').text()).toContain(completeDescription);
    own.unmount();
  });
});
