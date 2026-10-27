import { mount } from '@vue/test-utils';
import { describe, it, expect } from 'vitest';
import VariantHullmodDetails from './VariantHullmodDetails.vue';
import ImmersiveText from '../ImmersiveText.vue';
import type { JointVariantEntry } from '@/shared/types';
describe('static original hullmod tooltip', () => {
  it('shows heading, ordered static descriptions and gray short text with parameter placeholders', () => {
    const source = { source: 'mod' as const, root: 'M:/mod', path: 'M:/mod/mods.csv', relPath: 'mods.csv' };
    const entry: JointVariantEntry = {
      id: 'mod',
      label: '名称原文',
      data: {
        desc: 'Boost %s.\n\nThen %s.',
        short: 'Short %s',
        sModDesc: 'S %s',
        'tech/manufacturer': 'High Tech',
      },
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
        images: {},
      },
      global: {
        stubs: {
          ImmersiveText: { props: ['text', 'runs', 'font'], template: "<span>{{runs?runs.map(run=>run.text).join(''):text}}</span>" },
        },
      },
    });
    expect(own.findComponent(ImmersiveText).props('font')).toBe('heading');
    expect(own.find('header').text()).toBe('名称原文');
    expect(own.findAll('p').map((paragraph) => paragraph.text())).toEqual([
      '设计类型：High Tech',
      'Boost [脚本参数 1].',
      'Then [脚本参数 2].',
      'Short [脚本参数 1]',
      'S [脚本参数 1]',
    ]);
    expect(own.find('section').findComponent(ImmersiveText).props('text')).toBe('S 强化效果静态说明');
    const short = own.findAllComponents(ImmersiveText).find((text) => text.text().startsWith('Short'))!;
    expect(short.text()).toBe('Short [脚本参数 1]');
    expect(short.props('runs')!.every((run) => run.color === '#afafaf')).toBe(true);
    own.unmount();
  });
});
