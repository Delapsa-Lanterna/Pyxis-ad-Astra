import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import VariantHullmodDetails from './VariantHullmodDetails.vue';
import ImmersiveText from './ImmersiveText.vue';
import type { JointVariantEntry } from '@/shared/types';
describe('static original hullmod tooltip', () => {
  it('consumes heading font, preserved raw text, S description and sequential parameter diagnostics', () => {
    const source = { source: 'mod' as const, root: 'M:/mod', path: 'M:/mod/mods.csv', relPath: 'mods.csv' };
    const entry: JointVariantEntry = {
      id: 'mod',
      label: '名称原文',
      data: { desc: 'Boost %s.\n\nThen %s.', sModDesc: 'S %s', script: 'data.Mod', cost_cruiser: '20', 'tech/manufacturer': 'High Tech' },
      source,
      sourceVersion: { path: source.path, fingerprint: 'v' },
      resourceRefs: {},
      spec: null,
      specSource: null,
      specVersion: null,
      preview: null,
      projectile: null,
      primaryRole: null,
    };
    const own = mount(VariantHullmodDetails, {
      props: {
        entry,
        reference: { referenceSettings: { resources: {}, values: {}, versions: [] } },
        hullSize: 'CRUISER',
        available: 5,
        images: {},
      },
      global: {
        stubs: {
          ImmersiveText: { props: ['text', 'runs', 'font'], template: "<span>{{runs?runs.map(run=>run.text).join(''):text}}</span>" },
        },
      },
    });
    expect(own.findComponent(ImmersiveText).props('font')).toBe('heading');
    expect(own.text()).toContain('Then [脚本参数 2]');
    expect(own.text()).toContain('S强化静态说明');
    expect(own.find('details').text()).toContain('Boost %s.');
    expect(own.find('details').text()).toContain('data.Mod');
    expect(own.text()).toContain('超预算');
    own.unmount();
  });
});
